// Inspect dimensions before decoding untrusted raster data into a full RGBA surface.
export function raster(data: Uint8Array): boolean {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	function check(w: number, h: number) {
		if (!w || !h || w > 8192 || h > 8192 || w * h > 8000000)
			throw Error("image");
		return true;
	}
	if (
		data.length >= 24 &&
		view.getUint32(0) === 0x89504e47 &&
		view.getUint32(4) === 0x0d0a1a0a &&
		view.getUint32(12) === 0x49484452
	)
		return check(view.getUint32(16), view.getUint32(20));
	if (data[0] !== 255 || data[1] !== 216) return false;
	for (let i = 2; i + 8 < data.length; ) {
		if (data[i++] !== 255) throw Error("image");
		while (data[i] === 255) i++;
		const marker = data[i++],
			len = view.getUint16(i);
		if (len < 2 || len > data.length - i) throw Error("image");
		if ([192, 193, 194].includes(marker))
			return check(view.getUint16(i + 5), view.getUint16(i + 3));
		i += len;
	}
	throw Error("image");
}
