// Rasterize public/icon.svg -> assets/icon.png (1024x1024) for `tauri icon`.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

mkdirSync("assets", { recursive: true });
const svg = readFileSync("public/icon.svg", "utf8");
const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } });
writeFileSync("assets/icon.png", resvg.render().asPng());
console.log("assets/icon.png geschrieben");
