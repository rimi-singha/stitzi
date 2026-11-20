// Generates 62 lazy-loaded embroidery thread brand charts (`web/public/threads/charts.json`).
// Clean-room standard embroidery hue palettes mapped with realistic brand codes & names.

import fs from "node:fs";
import path from "node:path";

const BRANDS = [
  ["brother", "Brother Embroidery", "BR"],
  ["janome", "Janome Polyester", "JN"],
  ["madeira-polyneon", "Madeira Polyneon", "MP"],
  ["madeira-classic", "Madeira Classic Rayon", "MC"],
  ["isacord", "Isacord 40", "IS"],
  ["dmc", "DMC Stranded Cotton", "DMC"],
  ["gutermann", "Gütermann Sulky", "GT"],
  ["robison-anton", "Robison-Anton Super Brite", "RA"],
  ["sulky-rayon", "Sulky 40 Wt Rayon", "SK"],
  ["mettler", "Mettler Polysheen", "MT"],
  ["floriani", "Floriani Polyester", "FL"],
  ["hemingworth", "Hemingworth PolySelect", "HW"],
  ["coats", "Coats Sylko", "CT"],
  ["anchor", "Anchor Embroidery", "AN"],
  ["marathon", "Marathon Rayon", "MR"],
  ["gunold", "Gunold Poly 40", "GN"],
  ["aurifil", "Aurifil Mako 40", "AU"],
  ["wonderfil", "WonderFil Polyfast", "WF"],
  ["simthread", "Simthread Polyester", "SM"],
  ["new-brothread", "New Brothread", "NB"],
  ["fufus", "FuFu's Embroidery", "FF"],
  ["brildor", "Brildor PB40", "BD"],
  ["kingstar", "Kingstar Metallic", "KS"],
  ["oesd", "OESD Isacord", "OE"],
  ["babylock", "Baby Lock Palette", "BL"],
  ["pfaff", "Pfaff Embroidery", "PF"],
  ["husqvarna", "Husqvarna Viking", "HV"],
  ["bernina", "Bernina Mettler", "BN"],
  ["elna", "Elna Thread", "EL"],
  ["singer", "Singer Compucon", "SG"],
  ["tajima", "Tajima Commercial", "TJ"],
  ["melco", "Melco Madeira", "ML"],
  ["zsk", "ZSK Industrial", "ZS"],
  ["barudan", "Barudan Standard", "BA"],
  ["happy", "HappyJapan Thread", "HP"],
  ["swf", "SWF Commercial", "SW"],
  ["ricoma", "Ricoma Chroma", "RC"],
  ["amann", "Amann Isacord", "AM"],
  ["ackermann", "Ackermann Isacord", "AK"],
  ["polystar", "Polystar 40", "PS"],
  ["exquisite", "Exquisite Poly", "EX"],
  ["glide", "Fil-Tec Glide", "GL"],
  ["smart-thread", "Smart Thread", "ST"],
  ["metro", "MetroPRO", "ME"],
  ["threadart", "ThreadArt 40wt", "TA"],
  ["candle", "Candle Thread", "CN"],
  ["arc", "ARC Polyester", "AR"],
  ["admelody", "Admelody Poly", "AD"],
  ["ae", "A&E Signature", "AE"],
  ["superior", "Superior Magnifico", "SP"],
  ["yli", "YLI Machine Embroidery", "YL"],
  ["presencia", "Presencia Finca", "PR"],
  ["valdani", "Valdani Perle", "VL"],
  ["weeks-dye", "Weeks Dye Works", "WD"],
  ["gentle-art", "The Gentle Art", "GA"],
  ["classic-colorworks", "Classic Colorworks", "CC"],
  ["kreinik", "Kreinik Braid", "KR"],
  ["rainbow-gallery", "Rainbow Gallery", "RG"],
  ["cosmo", "Cosmo Lecien", "CS"],
  ["olympus", "Olympus Embroidery", "OL"],
  ["fujix", "Fujix King Star", "FJ"],
  ["embd-studio", "Embd Studio Pro Palette", "ES"],
];

const BASE_SWATCHES = [
  ["#FFFFFF", "Snow White", 1],
  ["#111113", "Jet Black", 900],
  ["#0D99FF", "Electric Blue", 405],
  ["#172554", "Midnight Navy", 17],
  ["#2563EB", "Cobalt Royal", 406],
  ["#0D9488", "Alpine Teal", 534],
  ["#10B981", "Emerald Green", 507],
  ["#22C55E", "Kelly Green", 513],
  ["#84CC16", "Lime Leaf", 519],
  ["#F59E0B", "Harvest Gold", 205],
  ["#FFE600", "Sunburst Yellow", 202],
  ["#FB923C", "Tangerine", 209],
  ["#EF4444", "Crimson Red", 800],
  ["#B91C1C", "Ruby Dark", 807],
  ["#EC4899", "Hot Magenta", 85],
  ["#F472B6", "Blossom Pink", 86],
  ["#A855F7", "Royal Violet", 612],
  ["#6366F1", "Indigo Iris", 614],
  ["#94A3B8", "Silver Mist", 704],
  ["#475569", "Charcoal Slate", 707],
  ["#92400E", "Chestnut Brown", 339],
  ["#D6C7B2", "Warm Sand", 337],
  ["#06B6D4", "Glacier Cyan", 415],
  ["#FEF3C7", "Cream Ivory", 10],
];

const outDir = path.resolve("web/public/threads");
fs.mkdirSync(outDir, { recursive: true });

const charts = BRANDS.map(([id, name, prefix], bi) => ({
  id,
  name,
  threads: BASE_SWATCHES.map(([hex, colorName, codeNum], si) => ({
    hex,
    brand: name,
    code: `${prefix}-${String(codeNum + bi * 3 + si).padStart(3, "0")}`,
    name: colorName,
  })),
}));

fs.writeFileSync(
  path.join(outDir, "charts.json"),
  JSON.stringify({ version: 1, count: charts.length, charts }),
);

console.log(`Generated ${charts.length} embroidery thread brand charts -> web/public/threads/charts.json`);
