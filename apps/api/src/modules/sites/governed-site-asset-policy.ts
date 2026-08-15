import { createHash } from 'node:crypto';
export {
  GOVERNED_SITE_ASSET_CATEGORIES,
  GOVERNED_SITE_ASSET_CONSENT_STATUSES,
  GOVERNED_SITE_ASSET_MIME_TYPES,
  GOVERNED_SITE_ASSET_SCAN_STATUSES,
  governedSiteAssetKind,
  isGovernedSiteAssetEligible,
} from '@ks-os/site-generation';

/** A stable UUID-shaped reference scoped to one site and one governed upload. */
export function governedSiteAssetReference(siteId: string, uploadReference: string) {
  const bytes = Buffer.from(createHash('sha256')
    .update(`ks-os:governed-site-asset:${siteId}:${uploadReference}`)
    .digest()
    .subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function governedSiteAssetUrl(input: {
  publicOrigin: string;
  siteReference: string;
  assetReference: string;
  uploadReference: string;
}) {
  const path = [
    '/api/v1/public/site-assets',
    input.siteReference,
    input.assetReference,
    input.uploadReference,
  ].join('/');
  return new URL(path, `${input.publicOrigin.replace(/\/$/, '')}/`).toString();
}

export function governedSiteAssetAlt(input: {
  businessName: string;
  category: string;
  safeFilename: string;
}) {
  if (input.category === 'LOGO') return `${input.businessName} logo`.slice(0, 500);
  if (input.category === 'TEAM_PHOTO') return `${input.businessName} team`.slice(0, 500);
  if (input.category === 'LOCATION_PHOTO') return `${input.businessName} location`.slice(0, 500);
  const label = input.safeFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return (label || `${input.businessName} ${input.category.toLowerCase().replaceAll('_', ' ')}`).slice(0, 500);
}

function validDimensions(width: number, height: number) {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0 && width <= 65_535 && height <= 65_535
    ? { width, height }
    : null;
}

function jpegDimensions(bytes: Buffer) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)) {
      return validDimensions(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Buffer) {
  const kind = bytes.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X' && bytes.length >= 30) {
    return validDimensions(
      1 + bytes.readUIntLE(24, 3),
      1 + bytes.readUIntLE(27, 3),
    );
  }
  if (kind === 'VP8 ' && bytes.length >= 30
    && bytes.subarray(23, 26).toString('hex') === '9d012a') {
    return validDimensions(
      bytes.readUInt16LE(26) & 0x3fff,
      bytes.readUInt16LE(28) & 0x3fff,
    );
  }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const packed = bytes.readUInt32LE(21);
    return validDimensions(
      1 + (packed & 0x3fff),
      1 + ((packed >> 14) & 0x3fff),
    );
  }
  return null;
}

function avifDimensions(bytes: Buffer) {
  let offset = 0;
  while (offset >= 0 && offset + 16 <= bytes.length) {
    const index = bytes.indexOf('ispe', offset, 'ascii');
    if (index < 0 || index + 16 > bytes.length) return null;
    const boxStart = index - 4;
    const boxSize = boxStart >= 0 ? bytes.readUInt32BE(boxStart) : 0;
    if (boxSize >= 20 && boxStart + boxSize <= bytes.length) {
      const dimensions = validDimensions(
        bytes.readUInt32BE(index + 8),
        bytes.readUInt32BE(index + 12),
      );
      if (dimensions) return dimensions;
    }
    offset = index + 4;
  }
  return null;
}

export function governedImageDimensions(bytes: Buffer, mimeType: string) {
  if (mimeType === 'image/png' && bytes.length >= 24
    && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return validDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (mimeType === 'image/jpeg' && bytes.subarray(0, 3).toString('hex') === 'ffd8ff') {
    return jpegDimensions(bytes);
  }
  if (mimeType === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return webpDimensions(bytes);
  }
  if (mimeType === 'image/avif' && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    return avifDimensions(bytes);
  }
  return null;
}
