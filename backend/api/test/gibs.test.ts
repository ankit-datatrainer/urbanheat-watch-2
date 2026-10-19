// NASA GIBS satellite LST decoding with MOCKED tiles and colormap (test-only).
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { GibsLstService, LST_LAYERS, compositeStarts } from "../src/gibs.js";

// Two colormap bands: 300.2-300.8 K (27.35 °C) and 320.0-320.6 K (47.15 °C).
const COLORMAP = `<ColorMap>
<ColorMapEntry rgb="64,64,64" transparent="true" sourceValue="[0,1)" nodata="true" ref="0"/>
${Array.from({ length: 120 }, (_, i) => `<ColorMapEntry rgb="10,${i},10" transparent="false" value="[${200 + i},${201 + i})"/>`).join("\n")}
<ColorMapEntry rgb="255,253,0" transparent="false" sourceValue="[15010,15040)" value="[300.20,300.80)" ref="169"/>
<ColorMapEntry rgb="255,151,0" transparent="false" sourceValue="[16000,16030)" value="[320.00,320.60)" ref="202"/>
</ColorMap>`;

/** A tile where the left half is 27.35 °C, the right half 47.15 °C, and the top rows are cloud. */
function tilePng() {
  const png = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      const cloud = y < 8;
      const [r, g, b] = x < 128 ? [255, 253, 0] : [255, 151, 0];
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = cloud ? 0 : 255;
    }
  }
  return PNG.sync.write(png);
}

function fakeFetch() {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    if (url.includes("colormaps")) return new Response(COLORMAP);
    return new Response(new Uint8Array(tilePng()), { headers: { "Content-Type": "image/png" } });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

describe("GIBS satellite LST", () => {
  it("decodes pixel colours back to °C with the colormap and skips cloud", async () => {
    const { impl } = fakeFetch();
    const svc = new GibsLstService(impl);
    // Longitude 102.66 is the middle of z7 tile column 100, so a 5 km circle straddles both halves.
    const res = await svc.read(LST_LAYERS.MODIS_Terra_Land_Surface_Temp_Day!, "2026-10-16", 1.35, 102.66, 5);
    expect(res).not.toBeNull();
    expect(res!.validPixels).toBeGreaterThan(0);
    expect(res!.minC).toBeCloseTo(27.4, 1);
    expect(res!.maxC).toBeCloseTo(47.2, 1);
    expect(res!.tileUrlTemplate).toContain("MODIS_Terra_Land_Surface_Temp_Day/default/2026-10-16/");
  });

  it("lists MODIS 8-day period starts on day-of-year 1, 9, 17 ...", () => {
    expect(compositeStarts(3, new Date("2026-10-17T00:00:00Z"))).toEqual(["2026-10-16", "2026-10-08", "2026-09-30"]);
    expect(compositeStarts(2, new Date("2026-01-03T00:00:00Z"))).toEqual(["2026-01-01", "2025-12-27"]);
  });
});
