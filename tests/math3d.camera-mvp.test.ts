// tests/math3d.camera-mvp.test.ts
//
// PORTED from star-wars/tests/core/math3d.camera-mvp.test.ts (SH-2, ADR-0001
// extraction). Byte-for-byte the star-wars original below this SH-2 provenance
// note; only the import path (`../src/math3d`) is new. RED until GREEN adds
// arcade-shared/src/math3d.ts with `scaling` + `viewMatrix`.
//
// --- original star-wars header ---
// Story 11-2 — Camera + MVP transform pipeline (RED phase).
//
// ADR 0001 part B: introduce a real model→view→projection chain. The pure Math
// Box gains two builders — `scaling()` and `viewMatrix()` — and the shell will
// compose MVP = projection × view × model from them. These tests pin the PURE
// math contract only; the shell rewiring of render.ts (retiring SKIM_OFFSET /
// Z_SURFACE_PLACEMENT / surfacePlacement / trenchPlacement) is a visual change
// verified by eyeball in dev (:5274) + the contact sheet, per the AC and the
// repo convention that orientation/scale escape structural tests.
//
// CONTRACT DECISION (TEA): `viewMatrix(camPos: Vec3, orientation: Mat4)` takes
// the camera's orientation as a rotation matrix — the Math Box's native rotation
// representation (rotationX/Y/Z, lookRotation, Enemy.orient all return Mat4). The
// view matrix is the INVERSE of the camera's world placement
// `translation(camPos) ∘ orientation`. See the session's Delivery Findings for
// the alternative (forward-vector) signature, flagged non-blocking for Dev.
//
// These fail until GREEN adds `scaling` and `viewMatrix` to core/math3d.ts.

import { describe, it, expect } from 'vitest'
import {
  IDENTITY,
  multiply,
  transform,
  translation,
  rotationY,
  perspective,
  lookRotation,
  sub,
  length,
  scaling, // NEW (story 11-2)
  viewMatrix, // NEW (story 11-2)
  type Mat4,
  type Vec3,
} from '../src/math3d'

const dist = (a: Vec3, b: Vec3): number => length(sub(a, b))

/** Assert two 4×4 matrices are element-wise equal (and that `actual` is a Mat4). */
function expectMatClose(actual: Mat4, expected: Mat4): void {
  expect(actual.length).toBe(16)
  for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i], 6)
}

describe('scaling() — pure diagonal scale matrix (story 11-2)', () => {
  it('scales each axis independently', () => {
    const p = transform(scaling(2, 3, 4), [1, 1, 1])
    expect(p[0]).toBeCloseTo(2)
    expect(p[1]).toBeCloseTo(3)
    expect(p[2]).toBeCloseTo(4)
  })

  it('unit scale equals the identity matrix', () => {
    expectMatClose(scaling(1, 1, 1), IDENTITY)
  })

  it('leaves the origin fixed (a scale carries no translation)', () => {
    const o = transform(scaling(7, 7, 7), [0, 0, 0])
    expect(o[0]).toBeCloseTo(0)
    expect(o[1]).toBeCloseTo(0)
    expect(o[2]).toBeCloseTo(0)
  })

  it('negative scale mirrors across the axis', () => {
    const p = transform(scaling(-1, 1, 1), [5, 2, 3])
    expect(p[0]).toBeCloseTo(-5)
    expect(p[1]).toBeCloseTo(2)
    expect(p[2]).toBeCloseTo(3)
  })

  it('is the innermost S of a model matrix T∘R∘S — scale, then translate', () => {
    const model = multiply(translation(10, 0, 0), scaling(2, 2, 2))
    const p = transform(model, [1, 0, 0]) // scale → [2,0,0], then translate → [12,0,0]
    expect(p[0]).toBeCloseTo(12)
    expect(p[1]).toBeCloseTo(0)
    expect(p[2]).toBeCloseTo(0)
  })
})

describe('viewMatrix(camPos, orientation) — inverse camera transform (story 11-2)', () => {
  it('a camera at the origin with identity orientation is a no-op view', () => {
    expectMatClose(viewMatrix([0, 0, 0], IDENTITY), IDENTITY)
  })

  it('maps the camera position onto the eye origin (inverse-camera identity)', () => {
    const cam: Vec3 = [3, 5, -7]
    const eye = transform(viewMatrix(cam, IDENTITY), cam)
    expect(eye[0]).toBeCloseTo(0)
    expect(eye[1]).toBeCloseTo(0)
    expect(eye[2]).toBeCloseTo(0)
  })

  it('translates the world opposite the camera (the altitude-skim case)', () => {
    // Camera lifted to eye height 5 (the surface-skim camera); floor sits at y=0.
    const view = viewMatrix([0, 5, 0], IDENTITY)
    // A point at eye level, 10 ahead, lands dead ahead at the eye origin height.
    const ahead = transform(view, [0, 5, -10])
    expect(ahead[1]).toBeCloseTo(0)
    expect(ahead[2]).toBeCloseTo(-10)
    // The floor directly below is now 5 units below the eye.
    const floor = transform(view, [0, 0, -10])
    expect(floor[1]).toBeCloseTo(-5)
  })

  it('a rotated camera yields the inverse rotation (view ∘ camera = identity)', () => {
    const R = rotationY(0.6)
    const view = viewMatrix([0, 0, 0], R)
    // The view must UNDO the camera's rotation: view ∘ R = I.
    expectMatClose(multiply(view, R), IDENTITY)
  })

  it('is the exact inverse of the camera world transform translation∘orientation', () => {
    const cam: Vec3 = [12, -4, 30]
    const orient = lookRotation([1, 0, -2]) // a non-trivial camera facing
    const camWorld = multiply(translation(cam[0], cam[1], cam[2]), orient)
    // view ∘ camWorld = I — the defining inverse-camera property the AC names.
    expectMatClose(multiply(viewMatrix(cam, orient), camWorld), IDENTITY)
  })

  it('is rigid — it preserves distances between world points (no scale or shear)', () => {
    const view = viewMatrix([8, -3, 14], lookRotation([0.3, 1, -1]))
    const p: Vec3 = [1, 2, -50]
    const q: Vec3 = [-4, 6, -30]
    expect(dist(transform(view, p), transform(view, q))).toBeCloseTo(dist(p, q), 4)
  })

  it('is pure — identical inputs give an identical matrix (determinism)', () => {
    const a = viewMatrix([2, 9, -1], rotationY(0.4))
    const b = viewMatrix([2, 9, -1], rotationY(0.4))
    expectMatClose(a, b)
  })
})

describe('MVP = projection × view × model — full pipeline composition (story 11-2)', () => {
  const proj = perspective(Math.PI / 3, 1, 1, 1000) // square aspect → no x/y skew

  it('view ∘ model applies the model first, then the view (affine compose order)', () => {
    const view = viewMatrix([0, 5, 0], IDENTITY)
    const model = multiply(translation(0, 0, -100), scaling(2, 2, 2))
    const mv = multiply(view, model)
    const v: Vec3 = [1, 0, 0]
    // Affine stages (no perspective divide) → composing then transforming equals
    // staging model-then-view. This pins the documented view×model order.
    const staged = transform(view, transform(model, v))
    const composed = transform(mv, v)
    expect(composed[0]).toBeCloseTo(staged[0])
    expect(composed[1]).toBeCloseTo(staged[1])
    expect(composed[2]).toBeCloseTo(staged[2])
  })

  it('a model placed dead ahead projects to screen-centre NDC', () => {
    const view = viewMatrix([0, 0, 0], IDENTITY)
    const model = translation(0, 0, -100) // model centre 100 units ahead
    const mvp = multiply(multiply(proj, view), model)
    const ndc = transform(mvp, [0, 0, 0]) // the model centre
    expect(ndc[0]).toBeCloseTo(0)
    expect(ndc[1]).toBeCloseTo(0)
  })

  it('model scale enlarges the projected silhouette at a fixed depth', () => {
    const view = viewMatrix([0, 0, 0], IDENTITY)
    const place = translation(0, 0, -100)
    const vertex: Vec3 = [1, 0, 0] // a lateral model vertex
    const small = transform(multiply(multiply(proj, view), multiply(place, scaling(1, 1, 1))), vertex)
    const big = transform(multiply(multiply(proj, view), multiply(place, scaling(2, 2, 2))), vertex)
    expect(small[0]).not.toBeCloseTo(0) // guard: the vertex is genuinely off-centre
    // Same depth, twice the lateral extent → ~twice the NDC x.
    expect(Math.abs(big[0])).toBeGreaterThan(1.5 * Math.abs(small[0]))
  })

  it('raising the camera pushes a ground model downward in NDC (camera replaces the skim constant)', () => {
    const model = translation(0, 0, -100) // a point on the y=0 ground, dead ahead
    const low = transform(multiply(multiply(proj, viewMatrix([0, 0, 0], IDENTITY)), model), [0, 0, 0])
    const high = transform(multiply(multiply(proj, viewMatrix([0, 50, 0], IDENTITY)), model), [0, 0, 0])
    // Lifting the eye 50 units makes the same ground point sit lower on screen —
    // exactly what the retired SKIM_OFFSET faked, now carried by camera state.
    expect(high[1]).toBeLessThan(low[1])
  })
})
