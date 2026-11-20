// Client-side PDF Production Job Sheet generator using `pdf-lib` (works 100% offline in browser).

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getProductionRecipe } from "./productionAdvisor";
import type { Document, StitchPlanBuffers } from "../state/document";

export interface PdfJobSheetOptions {
  mode?: "operator" | "client";
  studioBrand?: string;
}

function hexToPdfRgb(hex: string) {
  const s = hex.replace("#", "");
  if (s.length !== 6) return rgb(0.05, 0.6, 1.0);
  return rgb(
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  );
}

export async function generatePdfJobSheet(
  doc: Document,
  plan: StitchPlanBuffers,
  previewPngBytes?: Uint8Array | null,
  options: PdfJobSheetOptions = {},
): Promise<Uint8Array> {
  const mode = options.mode ?? "operator";
  const brandTitle = (options.studioBrand?.trim() || "EMBD STUDIO").toUpperCase();
  const recipe = getProductionRecipe(doc.fabric, doc.threadWeight ?? 40);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 portrait
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const { height } = page.getSize();
  let y = height - 48;

  // Branded Header bar
  page.drawText(
    mode === "client"
      ? `${brandTitle} — CLIENT APPROVAL PROOF`
      : `${brandTitle} — OPERATOR PRODUCTION SHEET`,
    {
      x: 42,
      y,
      size: 15,
      font: bold,
      color: rgb(0.05, 0.45, 0.95),
    },
  );
  y -= 20;
  page.drawText(`Design: ${doc.name}`, { x: 42, y, size: 12, font: bold, color: rgb(0.1, 0.1, 0.12) });
  y -= 16;

  const stats = plan.meta.stats;
  const wMm = stats.bounds ? (stats.bounds.maxX - stats.bounds.minX).toFixed(1) : "0.0";
  const hMm = stats.bounds ? (stats.bounds.maxY - stats.bounds.minY).toFixed(1) : "0.0";
  const summary = `Size: ${wMm} x ${hMm} mm  |  Hoop: ${doc.hoop.name}  |  Fabric: ${doc.fabric}  |  Thread: No. ${doc.threadWeight ?? 40}`;
  page.drawText(summary, { x: 42, y, size: 9, font, color: rgb(0.3, 0.3, 0.35) });
  y -= 14;
  page.drawText(
    `Stitches: ${stats.stitchCount.toLocaleString()}  |  Colors: ${plan.meta.threads.length}  |  Trims: ${stats.trims}  |  Est. Time: ${stats.estimatedMinutes.toFixed(1)} min`,
    { x: 42, y, size: 9, font, color: rgb(0.3, 0.3, 0.35) },
  );
  y -= 16;

  if (mode === "operator") {
    page.drawText(
      `Backing: ${recipe.backing}  |  Topping: ${recipe.topping}`,
      { x: 42, y, size: 8.5, font, color: rgb(0.18, 0.25, 0.35) },
    );
    y -= 12;
    page.drawText(
      `Needle: ${recipe.needle}  |  Knockdown: ${doc.knockdown ? "ON" : "OFF"}  |  Basting Box: ${doc.bastingBox ? "ON" : "OFF"}`,
      { x: 42, y, size: 8.5, font, color: rgb(0.18, 0.25, 0.35) },
    );
    y -= 14;
  } else {
    page.drawText("Client Sign-Off: ___________________________   Date: _______________", {
      x: 42,
      y,
      size: 9,
      font,
      color: rgb(0.25, 0.25, 0.3),
    });
    y -= 16;
  }

  // Divider
  page.drawLine({
    start: { x: 42, y },
    end: { x: 553, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.88),
  });
  y -= 16;

  // Optional Realistic Preview Image
  if (previewPngBytes && previewPngBytes.length > 16) {
    try {
      const img = await pdf.embedPng(previewPngBytes);
      const maxW = 280;
      const maxH = 220;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      page.drawImage(img, {
        x: (595.28 - drawW) * 0.5,
        y: y - drawH,
        width: drawW,
        height: drawH,
      });
      y -= drawH + 24;
    } catch {
      // Skip invalid PNG cleanly
    }
  }

  // Thread Sequence Table
  page.drawText("COLOR SEQUENCE (IN SEW ORDER)", {
    x: 42,
    y,
    size: 10.5,
    font: bold,
    color: rgb(0.15, 0.15, 0.18),
  });
  y -= 18;

  for (let i = 0; i < plan.meta.threads.length; i++) {
    if (y < 60) break;
    const th = plan.meta.threads[i];
    const startIdx = plan.blockOffsets[i] ?? 0;
    const endIdx = plan.blockOffsets[i + 1] ?? plan.flags.length;
    const blockStitches = Math.max(0, endIdx - startIdx);

    page.drawRectangle({
      x: 42,
      y: y - 3,
      width: 14,
      height: 12,
      color: hexToPdfRgb(th.hex),
      borderColor: rgb(0.6, 0.6, 0.65),
      borderWidth: 0.5,
    });
    page.drawText(`${i + 1}.`, { x: 64, y, size: 9.5, font: bold, color: rgb(0.15, 0.15, 0.18) });
    page.drawText(`#${th.code}  ${th.name}`, {
      x: 84,
      y,
      size: 9.5,
      font: bold,
      color: rgb(0.12, 0.12, 0.15),
    });
    page.drawText(`${th.brand}`, { x: 260, y, size: 9, font, color: rgb(0.4, 0.4, 0.45) });
    page.drawText(`${blockStitches.toLocaleString()} stitches`, {
      x: 440,
      y,
      size: 9,
      font,
      color: rgb(0.25, 0.25, 0.3),
    });
    y -= 18;
  }

  return await pdf.save();
}
