const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectorySignature = 0x02014b50;
const localFileSignature = 0x04034b50;
const endOfCentralDirectoryLength = 22;
const maxCommentLength = 0xffff;
const stored = 0;
const deflated = 8;

// The only file in a zip archive, decompressed as it is read. Zip64 archives, over 4 GB, are not read.
export function unzipOnlyFile(zip: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const lastStart = zip.byteLength - endOfCentralDirectoryLength;
	let end = -1;
	for (let at = lastStart; at >= Math.max(0, lastStart - maxCommentLength); at--) {
		if (view.getUint32(at, true) === endOfCentralDirectorySignature) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new Error("The file is not a zip archive.");

	const fileCount = view.getUint16(end + 10, true);
	if (fileCount !== 1) throw new Error(`The zip archive holds ${fileCount} files instead of one.`);

	const entry = view.getUint32(end + 16, true);
	if (view.getUint32(entry, true) !== centralDirectorySignature) throw new Error("The zip archive has no directory.");
	const method = view.getUint16(entry + 10, true);
	const compressedSize = view.getUint32(entry + 20, true);
	const localHeader = view.getUint32(entry + 42, true);
	if (view.getUint32(localHeader, true) !== localFileSignature) throw new Error("The zip archive has no file where its directory says.");

	const start = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true);
	// The file is a view of the archive, not a copy: the archive of GeoNames is 11 MB.
	const file = zip.subarray(start, start + compressedSize);
	const data = new ReadableStream<Uint8Array<ArrayBuffer>>({
		start(controller) {
			controller.enqueue(file);
			controller.close();
		},
	});
	if (method === stored) return data;
	if (method === deflated) return data.pipeThrough(new DecompressionStream("deflate-raw"));
	throw new Error(`The zip archive is compressed with method ${method}, which cannot be read.`);
}
