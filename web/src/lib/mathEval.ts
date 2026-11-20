// Evaluates math expressions and physical unit conversions for scrubbable inputs.
// Examples: "1/4 in" -> 6.35, "2.5cm" -> 25, "10+5" -> 15, "80 / 2" -> 40.

export type LengthUnit = "mm" | "cm" | "in" | "px";

const UNIT_TO_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  px: 25.4 / 96,
};

/** Safe recursive-descent arithmetic evaluator (+, -, *, /, parentheses). */
function evalArithmetic(expr: string): number | null {
  const tokens = expr.match(/\d*\.?\d+|[()+\-*/]/g);
  if (!tokens) return null;
  let pos = 0;

  function parseExpr(): number {
    let val = parseTerm();
    while (pos < tokens!.length && (tokens![pos] === "+" || tokens![pos] === "-")) {
      const op = tokens![pos++];
      const rhs = parseTerm();
      val = op === "+" ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm(): number {
    let val = parseFactor();
    while (pos < tokens!.length && (tokens![pos] === "*" || tokens![pos] === "/")) {
      const op = tokens![pos++];
      const rhs = parseFactor();
      if (op === "/") {
        if (Math.abs(rhs) < 1e-12) return NaN;
        val /= rhs;
      } else {
        val *= rhs;
      }
    }
    return val;
  }

  function parseFactor(): number {
    if (tokens![pos] === "+") {
      pos++;
      return parseFactor();
    }
    if (tokens![pos] === "-") {
      pos++;
      return -parseFactor();
    }
    if (tokens![pos] === "(") {
      pos++;
      const val = parseExpr();
      if (tokens![pos] === ")") pos++;
      return val;
    }
    const num = parseFloat(tokens![pos++] ?? "NaN");
    return num;
  }

  const result = parseExpr();
  if (pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

/**
 * Parses a user-typed length/number string with optional units (`mm`, `cm`, `in`, `"`, `px`)
 * and arithmetic (`1/4 in`, `10+5`, `25.4mm`), returning a value in millimeters (or raw number if unitless).
 */
export function evaluateLengthMm(raw: string, defaultUnit: LengthUnit = "mm"): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  let unit: LengthUnit = defaultUnit;
  let expr = trimmed;

  if (expr.endsWith("mm")) {
    unit = "mm";
    expr = expr.slice(0, -2).trim();
  } else if (expr.endsWith("cm")) {
    unit = "cm";
    expr = expr.slice(0, -2).trim();
  } else if (expr.endsWith("in") || expr.endsWith('"')) {
    unit = "in";
    expr = expr.replace(/(in|")$/, "").trim();
  } else if (expr.endsWith("px")) {
    unit = "px";
    expr = expr.slice(0, -2).trim();
  }

  // Handle mixed fraction like "1 1/4" -> "(1 + 1/4)"
  expr = expr.replace(/^(-?\d+)\s+(\d+\s*\/\s*\d+)$/, "($1+$2)");
  const value = evalArithmetic(expr);
  if (value === null) return null;
  return value * UNIT_TO_MM[unit];
}

export function formatLength(mm: number, unit: "mm" | "in", decimals = 1): string {
  if (unit === "in") {
    return (mm / 25.4).toFixed(Math.max(2, decimals));
  }
  return mm.toFixed(decimals);
}
