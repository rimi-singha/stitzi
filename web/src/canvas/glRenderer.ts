// Instanced WebGL2 Realistic 3D-Sheen Stitch Renderer
// Renders up to 150,000+ stitches as shaded cylindrical thread capsules at 60 FPS,
// with GPU live-drag transforms (u_dragMat) and all 4 Views:
//   1 = Vector, 2 = Technical Stitch + Jumps, 3 = Realistic 3D Thread Sheen, 4 = Finished Piece

import { STITCH_FLAGS, type StitchPlanBuffers, type Transform2D } from "../state/document";
import type { ViewMode } from "../state/store";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

const VERT_SRC = `#version 300 es
precision highp float;
precision highp int;

// Per-vertex quad corner: x in [0, 1] along stitch, y in [-1, 1] across thread width
layout(location = 0) in vec2 a_quad;
// Per-instance stitch segment
layout(location = 1) in vec2 a_p0;
layout(location = 2) in vec2 a_p1;
layout(location = 3) in float a_objId;
layout(location = 4) in float a_flags;

uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform float u_zoom;
uniform int u_viewMode;
uniform int u_hasDrag;
uniform mat3 u_dragMat;
uniform int u_dragIdCount;
uniform float u_dragIds[64];

out vec2 v_uv;
out float v_lenMm;
out float v_flags;

vec2 applyDrag(vec2 p, float objId) {
  if (u_hasDrag == 1) {
    for (int i = 0; i < 64; i++) {
      if (i >= u_dragIdCount) break;
      if (abs(objId - u_dragIds[i]) < 0.25) {
        return (u_dragMat * vec3(p, 1.0)).xy;
      }
    }
  }
  return p;
}

void main() {
  int f = int(a_flags + 0.5);
  bool isJump = (f & 2) != 0 || (f & 4) != 0;
  bool isTravel = (f & 64) != 0;

  // Finished Piece (View 4) hides snipped jump threads & removable travel
  if (u_viewMode == 4 && (isJump || isTravel)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Realistic View (3) hides jump moves
  if (u_viewMode == 3 && isJump) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 w0 = applyDrag(a_p0, a_objId);
  vec2 w1 = applyDrag(a_p1, a_objId);

  vec2 d = w1 - w0;
  float lenMm = length(d);
  if (lenMm < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 dir = d / lenMm;
  vec2 perp = vec2(-dir.y, dir.x);

  // Thread thickness: ~0.42 mm realistic #40 rayon thread, thinner in Stitch View 2
  float halfWidthMm = (u_viewMode == 2)
    ? max(0.10, 0.75 / max(u_zoom, 0.5))
    : max(0.21, 0.95 / max(u_zoom, 0.5));
  if (isJump) halfWidthMm = max(0.06, 0.5 / max(u_zoom, 0.5));

  // Extend slightly past endpoints for rounded needle-hole caps
  float pad = min(halfWidthMm * 0.45, lenMm * 0.25);
  vec2 along = mix(w0 - dir * pad, w1 + dir * pad, a_quad.x);
  vec2 world = along + perp * (a_quad.y * halfWidthMm);

  vec2 screen = (world - u_camera) * u_zoom + u_resolution * 0.5;
  vec2 ndc = (screen / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);

  v_uv = a_quad;
  v_lenMm = lenMm;
  v_flags = a_flags;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;

uniform vec3 u_color;
uniform int u_viewMode;
in vec2 v_uv;
in float v_lenMm;
in float v_flags;
out vec4 outColor;

void main() {
  int f = int(v_flags + 0.5);
  bool isJump = (f & 2) != 0 || (f & 4) != 0;
  bool isUnderlay = (f & 32) != 0;

  if (u_viewMode == 2) {
    if (isJump) {
      // Dashed jump indicator in Stitch view
      float dash = fract(v_uv.x * max(4.0, v_lenMm * 1.5));
      if (dash > 0.5) discard;
      outColor = vec4(0.58, 0.64, 0.72, 0.65);
      return;
    }
    vec3 col = isUnderlay ? mix(u_color, vec3(0.45), 0.35) : u_color;
    // Highlight crisp needle entry dots near stitch ends
    float endDist = min(v_uv.x, 1.0 - v_uv.x) * v_lenMm;
    if (endDist < 0.14) col = mix(col, vec3(0.05), 0.35);
    outColor = vec4(col, 0.96);
    return;
  }

  // Realistic 3D Cylindrical Rayon/Poly Thread Shading (Views 3 & 4)
  float ny = abs(v_uv.y);
  // Soft rounded capsule alpha at edges
  float alpha = 1.0 - smoothstep(0.78, 1.0, ny);
  if (alpha < 0.05) discard;

  // Cylindrical surface normal Z (brightest along center ridge, darker at edges)
  float nz = sqrt(max(0.0, 1.0 - ny * ny));
  // Needle hole pinch ambient occlusion at both stitch endpoints
  float endFade = smoothstep(0.0, 0.16, v_uv.x) * smoothstep(0.0, 0.16, 1.0 - v_uv.x);
  // Subtle diagonal 2-ply yarn twist modulation
  float twist = 0.95 + 0.08 * sin((v_uv.x * v_lenMm * 14.0) + v_uv.y * 2.2);

  // Diffuse + silky specular sheen along the ridge
  float diff = (0.48 + 0.55 * nz) * (0.58 + 0.42 * endFade) * twist;
  float spec = pow(nz, 6.0) * 0.24 * endFade;

  vec3 base = isUnderlay ? u_color * 0.78 : u_color;
  vec3 shaded = clamp(base * diff + vec3(spec), 0.0, 1.0);
  outColor = vec4(shaded, alpha * 0.98);
}
`;

function hexToRgbNorm(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  if (s.length !== 6) return [0.05, 0.6, 1.0];
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export class WebGLStitchRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quadVbo: WebGLBuffer;
  private segVbo: WebGLBuffer;

  private uResolution: WebGLUniformLocation | null;
  private uCamera: WebGLUniformLocation | null;
  private uZoom: WebGLUniformLocation | null;
  private uColor: WebGLUniformLocation | null;
  private uViewMode: WebGLUniformLocation | null;
  private uHasDrag: WebGLUniformLocation | null;
  private uDragMat: WebGLUniformLocation | null;
  private uDragIdCount: WebGLUniformLocation | null;
  private uDragIds: WebGLUniformLocation | null;

  private segmentCount = 0;
  private blocks: Array<{ startSeg: number; countSeg: number; color: [number, number, number] }> = [];
  private dragIdBuf = new Float32Array(64);

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = prog;

    this.uResolution = gl.getUniformLocation(prog, "u_resolution");
    this.uCamera = gl.getUniformLocation(prog, "u_camera");
    this.uZoom = gl.getUniformLocation(prog, "u_zoom");
    this.uColor = gl.getUniformLocation(prog, "u_color");
    this.uViewMode = gl.getUniformLocation(prog, "u_viewMode");
    this.uHasDrag = gl.getUniformLocation(prog, "u_hasDrag");
    this.uDragMat = gl.getUniformLocation(prog, "u_dragMat");
    this.uDragIdCount = gl.getUniformLocation(prog, "u_dragIdCount");
    this.uDragIds = gl.getUniformLocation(prog, "u_dragIds[0]");

    this.vao = gl.createVertexArray()!;
    this.quadVbo = gl.createBuffer()!;
    this.segVbo = gl.createBuffer()!;

    // Unit quad (2 triangles = 6 vertices)
    const quadVerts = new Float32Array([
      0, -1, 1, -1, 1, 1,
      0, -1, 1, 1, 0, 1,
    ]);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Interleaved per-instance stitch segments: [x0, y0, x1, y1, objId, flags] = 6 floats (24 bytes)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segVbo);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(3, 1);

    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 20);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Packs stitch segments into a single instanced VBO and returns upload duration in ms. */
  uploadPlan(plan: StitchPlanBuffers): number {
    const t0 = performance.now();
    const gl = this.gl;
    const n = plan.flags.length;
    if (n < 2) {
      this.segmentCount = 0;
      this.blocks = [];
      return performance.now() - t0;
    }

    const offsets = plan.blockOffsets;
    const threads = plan.meta.threads;
    const maxSegs = n;
    const segData = new Float32Array(maxSegs * 6);
    let writeSeg = 0;
    this.blocks = [];

    for (let b = 0; b < offsets.length; b++) {
      const startV = offsets[b];
      const endV = b + 1 < offsets.length ? offsets[b + 1] : n;
      const blockStartSeg = writeSeg;

      for (let i = startV + 1; i < endV; i++) {
        const flag = plan.flags[i];
        if ((flag & STITCH_FLAGS.STOP) !== 0) continue;
        const base = writeSeg * 6;
        segData[base] = plan.coords[(i - 1) * 2];
        segData[base + 1] = plan.coords[(i - 1) * 2 + 1];
        segData[base + 2] = plan.coords[i * 2];
        segData[base + 3] = plan.coords[i * 2 + 1];
        segData[base + 4] = plan.objectIds[i];
        segData[base + 5] = flag;
        writeSeg += 1;
      }

      if (writeSeg > blockStartSeg) {
        this.blocks.push({
          startSeg: blockStartSeg,
          countSeg: writeSeg - blockStartSeg,
          color: hexToRgbNorm(threads[b]?.hex ?? "#0D99FF"),
        });
      }
    }

    this.segmentCount = writeSeg;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segVbo);
    gl.bufferData(gl.ARRAY_BUFFER, segData.subarray(0, writeSeg * 6), gl.STATIC_DRAW);
    return performance.now() - t0;
  }

  render(
    widthCss: number,
    heightCss: number,
    dpr: number,
    camera: CameraState,
    viewMode: ViewMode,
    maxVisibleStitches: number | null,
    dragDelta: Transform2D | null = null,
    dragObjectIndices: number[] = [],
  ) {
    const gl = this.gl;
    const targetW = Math.max(1, Math.round(widthCss * dpr));
    const targetH = Math.max(1, Math.round(heightCss * dpr));
    if (gl.canvas.width !== targetW || gl.canvas.height !== targetH) {
      gl.canvas.width = targetW;
      gl.canvas.height = targetH;
    }

    gl.viewport(0, 0, targetW, targetH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.segmentCount < 1 || viewMode === 1) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uResolution, widthCss, heightCss);
    gl.uniform2f(this.uCamera, camera.x, camera.y);
    gl.uniform1f(this.uZoom, camera.zoom);
    gl.uniform1i(this.uViewMode, viewMode);

    if (dragDelta && dragObjectIndices.length > 0) {
      const count = Math.min(64, dragObjectIndices.length);
      for (let i = 0; i < count; i++) this.dragIdBuf[i] = dragObjectIndices[i];
      gl.uniform1i(this.uHasDrag, 1);
      gl.uniform1i(this.uDragIdCount, count);
      gl.uniform1fv(this.uDragIds, this.dragIdBuf);
      gl.uniformMatrix3fv(
        this.uDragMat,
        false,
        new Float32Array([
          dragDelta.a, dragDelta.b, 0,
          dragDelta.c, dragDelta.d, 0,
          dragDelta.tx, dragDelta.ty, 1,
        ]),
      );
    } else {
      gl.uniform1i(this.uHasDrag, 0);
    }

    const limit =
      maxVisibleStitches === null
        ? this.segmentCount
        : Math.max(0, Math.min(this.segmentCount, Math.floor(maxVisibleStitches)));

    // Bind instanced segment attributes per block offset cleanly via vertexAttribPointer offset
    const stride = 6 * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segVbo);
    for (const block of this.blocks) {
      if (block.startSeg >= limit) break;
      const drawCount = Math.min(block.countSeg, limit - block.startSeg);
      if (drawCount < 1) continue;
      const byteOff = block.startSeg * stride;
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, byteOff);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, byteOff + 8);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, byteOff + 16);
      gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, byteOff + 20);
      gl.uniform3f(this.uColor, block.color[0], block.color[1], block.color[2]);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, drawCount);
    }

    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.quadVbo);
    gl.deleteBuffer(this.segVbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
