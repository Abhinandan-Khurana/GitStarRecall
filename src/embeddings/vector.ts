export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vec.length; i += 1) {
    sumSquares += vec[i] * vec[i];
  }

  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    return vec.slice();
  }

  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    out[i] = vec[i] / norm;
  }
  return out;
}

export function float32ToBlob(vec: Float32Array): Uint8Array {
  const normalized = l2Normalize(vec);
  const bytes = new Uint8Array(normalized.length * Float32Array.BYTES_PER_ELEMENT);
  new Float32Array(bytes.buffer).set(normalized);
  return bytes;
}

export function blobToFloat32(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / Float32Array.BYTES_PER_ELEMENT);
}
