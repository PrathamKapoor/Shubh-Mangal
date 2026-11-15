import { test, expect } from "@playwright/test";
const env = process.env;
const providerEnabled =
  env.VITE_GOOGLE_MAPS_ENABLED === "true" &&
  Boolean(env.VITE_GOOGLE_MAPS_KEY?.trim());

const geometry = {
  type: "Polygon",
  coordinates: [
    [
      [74.9, 24.46],
      [74.91, 24.46],
      [74.91, 24.47],
      [74.9, 24.46],
    ],
  ],
};
const official = {
  type: "Feature",
  id: "official",
  properties: {
    featureType: "plot",
    plotId: "official",
    geometryId: "cell",
    revisionId: "revision",
    version: 2,
    publication: "published",
  },
  geometry,
};
// This adapter replaces only Google's network boundary. The actual component,
// React lifecycle, matching, fetch, filtering and event handlers run unchanged.
const adapter = `(() => {
  const state = window.mapAdapter = {fits:0, pans:0, circles:[], features:[], layers:[], type:'roadmap'};
  class Circle {
    constructor(options){this.options=options;this.attached=!!options.map;state.circles.push(this);}
    setMap(map){this.attached=!!map;}
  }
  class Data {
    constructor(){this.features=[];state.layer=this;state.layers.push(this);}
    setMap(map){state.attached=!!map;}
    addGeoJson(fc){state.geometries=Object.fromEntries(fc.features.map(f=>[f.id,f.geometry]));this.features=fc.features.map(f=>({getId:()=>f.id,getProperty:k=>f.properties[k]}));state.features=this.features.map(f=>f.getId());return this.features;}
    forEach(fn){[...this.features].forEach(fn);}
    remove(f){this.features=this.features.filter(x=>x!==f);state.features=this.features.map(f=>f.getId());}
    setStyle(fn){if(typeof fn==='function') state.styles=Object.fromEntries(this.features.map(f=>[f.getId(),fn(f)])); else this.style=fn;}
    addListener(name,fn){this.click=fn;state.click=fn;return {remove(){state.click=null;}};}
  }
  class Map {
    constructor(element,options){state.type=options.mapTypeId;element.textContent='Native map fixture';}
    fitBounds(bounds){state.fits++;state.bounds=bounds;}
    setMapTypeId(type){state.type=type;}
    panTo(point){state.pans++;state.position=point;}
  }
  window.google={maps:{Map,Data,Circle,event:{clearInstanceListeners(){}}}};
  window[new URL(document.currentScript.src).searchParams.get('callback')]();
})();`;

async function mount(
  page,
  {
    script = adapter,
    payload = { type: "FeatureCollection", features: [official], mappings: [] },
  } = {},
) {
  await page.route("https://maps.googleapis.com/**", (route) =>
    script === "error"
      ? route.abort()
      : route.fulfill({ contentType: "application/javascript", body: script }),
  );
  await page.route("**/api/public/geometry", (route) =>
    route.fulfill({ json: payload }),
  );
  await page.route("**/__google-map-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div><script type="module">
    const {default:GoogleMapView}=await import('/src/components/GoogleMapView.jsx');
    const {default:React}=await import('/__google-map-react');
    const {default:ReactDOM}=await import('/__google-map-dom');
    const createRoot=ReactDOM.createRoot;
    const layout=await (await fetch('/data/layout.json')).json();
    const root=createRoot(document.getElementById('root'));
    const props={data:layout,plots:[{id:'official',geometryId:'cell',version:2,approved:{},status:'available'},{id:'raw',path:'M100,100 L120,100 L120,120 L100,120 Z M105,105 L110,105 L110,110 L105,110 Z',status:'unverified'}],selected:'official',visibleIds:new Set(['official','raw']),onSelect:id=>window.chosen=id,onExit:()=>window.exited=true};
    window.renderMap=updates=>root.render(React.createElement(GoogleMapView,{...props,...updates}));
    window.unmountMap=()=>root.unmount();window.renderMap({});
  </script>`,
    }),
  );
  const mainSource = await (await page.request.get("/src/main.jsx")).text();
  const componentSource = await (
    await page.request.get("/src/components/GoogleMapView.jsx")
  ).text();
  const reactUrl = componentSource.match(
    /from ["']([^"']*\/react\.js[^"']*)["']/,
  )?.[1];
  const domUrl = mainSource.match(
    /from ["']([^"']*react-dom_client[^"']*)["']/,
  )?.[1];
  if (!reactUrl || !domUrl)
    throw Error("Vite did not resolve the real React modules");
  await page.route("**/__google-map-react", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export {default} from ${JSON.stringify(reactUrl)};`,
    }),
  );
  await page.route("**/__google-map-dom", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export {default} from ${JSON.stringify(domUrl)};`,
    }),
  );
  await page.goto("/__google-map-fixture");
}

test("native map matches features, styles filters, selects IDs and fits only explicitly", async ({
  page,
}) => {
  test.skip(
    !providerEnabled,
    "Run separately with VITE_GOOGLE_MAPS_ENABLED=true and VITE_GOOGLE_MAPS_KEY=fixture-key.",
  );
  await mount(page);
  await expect(page.getByText("Provisional boundaries")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter?.features))
    .toEqual(["official", "raw"]);
  expect(await page.evaluate(() => window.mapAdapter.fits)).toBe(1);
  expect(
    await page.evaluate(
      () => window.mapAdapter.geometries.raw.coordinates.length,
    ),
  ).toBe(2);
  await page.evaluate(() =>
    window.mapAdapter.click({ feature: window.mapAdapter.layer.features[0] }),
  );
  expect(await page.evaluate(() => window.chosen)).toBe("official");
  await page.evaluate(() =>
    window.renderMap({ selected: "raw", visibleIds: new Set(["raw"]) }),
  );
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter.styles.official.visible))
    .toBe(false);
  expect(
    await page.evaluate(() => window.mapAdapter.styles.raw.strokeWeight),
  ).toBe(4);
  expect(await page.evaluate(() => window.mapAdapter.fits)).toBe(1);
  await page.getByRole("button", { name: "Hybrid", exact: true }).click();
  expect(await page.evaluate(() => window.mapAdapter.type)).toBe("hybrid");
  await page.getByRole("button", { name: "Show entire site" }).click();
  expect(await page.evaluate(() => window.mapAdapter.fits)).toBe(2);
  await page.evaluate(() => window.unmountMap());
  expect(await page.evaluate(() => window.mapAdapter.attached)).toBe(false);
  expect(await page.evaluate(() => window.gm_authFailure)).toBeUndefined();
});

test("published entrance footprint is selectable on the controlled Google layer", async ({ page }) => {
  test.skip(!providerEnabled, "Requires separate controlled-key environment.");
  await mount(page);
  await expect.poll(() => page.evaluate(() => typeof window.renderMap)).toBe("function");
  await page.evaluate(() => window.renderMap({
    visitorAccess: {
      title: "Synthetic entrance", routeAccess: { lat: 24.466, lon: 74.908 },
      physicalAnchor: null, footprint: { outer: [[74.908,24.466],[74.9081,24.466],[74.908,24.4661],[74.908,24.466]], holes: [] },
    },
    onAccessSelect: () => { window.accessChosen = true; },
  }));
  await expect.poll(() => page.evaluate(() => window.mapAdapter.layers.some(layer => layer.features.some(feature => feature.getId() === "visitor-entrance")))).toBe(true);
  await page.evaluate(() => {
    const layer = window.mapAdapter.layers.find(entry => entry.features.some(feature => feature.getId() === "visitor-entrance"));
    layer.click({ feature: layer.features[0] });
  });
  expect(await page.evaluate(() => window.accessChosen)).toBe(true);
});

test("published structure footprint is selectable on the controlled Google layer", async ({ page }) => {
  test.skip(!providerEnabled, "Requires separate controlled-key environment.");
  await mount(page);
  await expect.poll(() => page.evaluate(() => typeof window.renderMap)).toBe("function");
  await page.evaluate(() => window.renderMap({
    structures: [{ id: "synthetic-building", kind: "structure", published: { title: "Synthetic building", footprint: { outer: [[74.909,24.467],[74.90915,24.467],[74.909,24.4671],[74.909,24.467]], holes: [] } } }],
    onStructureSelect: (id) => { window.structureChosen = id; },
  }));
  await expect.poll(() => page.evaluate(() => window.mapAdapter.layers.some((layer) => layer.features.some((feature) => feature.getId() === "synthetic-building")))).toBe(true);
  await page.evaluate(() => {
    const layer = window.mapAdapter.layers.find((entry) => entry.features.some((feature) => feature.getId() === "synthetic-building"));
    layer.click({ feature: layer.features[0] });
  });
  expect(await page.evaluate(() => window.structureChosen)).toBe("synthetic-building");
});

test("visitor location is intentional, shows metre uncertainty and never enters app requests or storage", async ({
  page,
  context,
}) => {
  test.skip(!providerEnabled, "Controlled provider adapter");
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 19.1234567,
    longitude: 72.7654321,
    accuracy: 750,
  });
  const appRequests = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      appRequests.push(r.url() + (r.postData() || ""));
  });
  await mount(page);
  await expect(
    page.getByRole("button", { name: "My location", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => window.mapAdapter.pans)).toBe(0);
  await page.getByRole("button", { name: "My location", exact: true }).click();
  await expect(page.getByTestId("location-status")).toContainText("750 m");
  await expect(page.getByTestId("location-status")).toContainText("outside");
  expect(
    await page.evaluate(() =>
      window.mapAdapter.circles
        .filter((c) => c.attached)
        .map((c) => c.options.radius),
    ),
  ).toContain(750);
  expect(await page.evaluate(() => window.mapAdapter.pans)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter.features.length))
    .toBe(2);
  expect(await page.evaluate(() => window.mapAdapter.pans)).toBe(1);
  await page.getByRole("button", { name: "Show entire site" }).click();
  expect(await page.evaluate(() => window.mapAdapter.fits)).toBe(2);
  expect(appRequests.join(" ")).not.toMatch(/19\.1234567|72\.7654321|750/);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toMatch(/19\.1234567|72\.7654321/);
  await page
    .getByRole("button", { name: "Clear location", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => window.mapAdapter.circles.filter((c) => c.attached).length,
    ),
  ).toBe(0);
});

for (const [code, message] of [[1,"permission was denied"],[2,"unavailable"],[3,"timed out"]])
  test(`visitor location error ${code} has a readable state and no marker`, async ({page}) => {
    test.skip(!providerEnabled,"Controlled provider adapter");
    await page.addInitScript(code => Object.defineProperty(navigator,"geolocation",{value:{getCurrentPosition(_success,failure){failure({code,message:"private diagnostic"});}}}),code);
    await mount(page);
    await page.getByRole("button",{name:"My location",exact:true}).click();
    await expect(page.getByTestId("location-status")).toContainText(message);
    expect(await page.evaluate(()=>window.mapAdapter.circles.length)).toBe(0);
    expect(await page.evaluate(()=>window.mapAdapter.pans)).toBe(0);
  });
test("refresh failure clears every overlay; focus recovers; mismatched official never becomes draft", async ({
  page,
}) => {
  test.skip(
    !providerEnabled,
    "Run separately with VITE_GOOGLE_MAPS_ENABLED=true and VITE_GOOGLE_MAPS_KEY=fixture-key.",
  );
  await mount(page);
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter?.features.length))
    .toBe(2);
  await page.route("**/api/public/geometry", (route) =>
    route.fulfill({ status: 503, json: { error: "offline" } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText(
    "Boundaries are unavailable",
  );
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter.features))
    .toEqual([]);
  await page.route("**/api/public/geometry", (route) =>
    route.fulfill({
      json: {
        type: "FeatureCollection",
        features: [
          { ...official, properties: { ...official.properties, version: 1 } },
        ],
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter.features))
    .toEqual(["raw"]);
  await expect(page.getByText(/Some published boundaries/)).toBeVisible();
});
test("no key or disabled does not request Maps and offers Plan fallback", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("maps.googleapis.com")) requests++;
  });
  test.skip(providerEnabled, "Default no-key/provider-disabled case.");
  await mount(page);
  await expect(page.getByRole("alert")).toContainText("not configured");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Back to Plan" }).click();
  expect(await page.evaluate(() => window.exited)).toBe(true);
});
test("late authentication failure explains reload and clears overlay", async ({
  page,
}) => {
  test.skip(
    !providerEnabled,
    "Run separately with VITE_GOOGLE_MAPS_ENABLED=true and VITE_GOOGLE_MAPS_KEY=fixture-key.",
  );
  await mount(page);
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter?.features.length))
    .toBe(2);
  await page.evaluate(() => window.gm_authFailure());
  await expect(page.getByRole("alert")).toContainText("reload");
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter.features))
    .toEqual([]);
  await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
});
test("network error has retry and Hindi Plan fallback", async ({ page }) => {
  test.skip(!providerEnabled, "Requires separate controlled-key environment.");
  await mount(page, { script: "error" });
  await expect(page.getByRole("alert")).toContainText("could not load");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.evaluate(() => window.renderMap({ hindi: true }));
  await expect(
    page.getByRole("button", { name: "प्लान पर लौटें" }),
  ).toBeVisible();
});

test("stalled geometry refresh times out, clears overlays and recovers on focus", async ({
  page,
}) => {
  test.skip(!providerEnabled, "Requires separate controlled-key environment.");
  await page.clock.install();
  await mount(page);
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter?.features.length))
    .toBe(2);
  let pending;
  await page.route("**/api/public/geometry", (route) => {
    pending = route;
  });
  const requested = page.waitForRequest("**/api/public/geometry");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await requested;
  await page.clock.fastForward(12001);
  await expect(page.getByRole("alert")).toContainText(
    "Boundaries are unavailable",
  );
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter.features))
    .toEqual([]);
  await pending.abort().catch(() => {});
  await page.route("**/api/public/geometry", (route) =>
    route.fulfill({
      json: { type: "FeatureCollection", features: [official] },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter.features))
    .toEqual(["official", "raw"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("refreshes at sixty seconds without refitting, then stops polling on unmount", async ({
  page,
}) => {
  test.skip(!providerEnabled, "Requires separate controlled-key environment.");
  await page.clock.install();
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/public/geometry")) requests++;
  });
  await mount(page);
  await expect
    .poll(() => page.evaluate(() => window.mapAdapter?.features.length))
    .toBe(2);
  const initial = requests;
  await page.clock.fastForward(60001);
  await expect.poll(() => requests).toBe(initial + 1);
  expect(await page.evaluate(() => window.mapAdapter.fits)).toBe(1);
  await page.evaluate(() => window.unmountMap());
  const afterUnmount = requests;
  await page.clock.fastForward(120001);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(requests).toBe(afterUnmount);
  expect(await page.evaluate(() => window.gm_authFailure)).toBeUndefined();
});
test("explorer Google fallback keeps the selected URL and local Plan usable", async ({
  page,
}) => {
  test.skip(providerEnabled, "Default no-key explorer acceptance");
  let providerRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("maps.googleapis.com")) providerRequests++;
  });
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await page.getByRole("button", { name: "Google Maps", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not configured");
  expect(providerRequests).toBe(0);
  await expect(
    page.getByRole("heading", { name: "Plan label B26", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to Plan", exact: true }).click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
  await expect(page).toHaveURL(/plot=plot-1-b26-cell-26/);
});
