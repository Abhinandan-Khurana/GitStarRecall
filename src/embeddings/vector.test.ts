import { blobToFloat32, float32ToBlob, l2Normalize } from "./vector";

describe("embedding vector helpers", () => {
  test("l2Normalize returns unit norm vector", () => {
    const vec = new Float32Array([3, 4]);
    const normalized = l2Normalize(vec);
    const norm = Math.hypot(normalized[0], normalized[1]);

    expect(norm).toBeCloseTo(1, 6);
    expect(normalized[0]).toBeCloseTo(0.6, 6);
    expect(normalized[1]).toBeCloseTo(0.8, 6);
  });

  test("float32ToBlob + blobToFloat32 round-trip normalized values", () => {
    const vec = new Float32Array([10, 0, 0, 0]);
    const blob = float32ToBlob(vec);
    const roundTrip = blobToFloat32(blob);

    expect(roundTrip.length).toBe(4);
    expect(roundTrip[0]).toBeCloseTo(1, 6);
    expect(roundTrip[1]).toBeCloseTo(0, 6);
  });
});
