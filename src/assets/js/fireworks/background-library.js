"use strict";

(function initFireworksBackgroundLibrary(global) {
	const DB_NAME = "whizzzest_fireworks_bg";
	const DB_VERSION = 1;
	const STORE_NAME = "images";
	const MAX_EDGE = 1920;
	const THUMB_EDGE = 160;
	const THUMB_QUALITY = 0.7;
	const ENCODE_QUALITY = 0.85;

	const LIMITS = Object.freeze({
		maxImages: 12,
		maxFileSize: 30 * 1024 * 1024,
	});

	let dbPromise = null;

	function isSupported() {
		return Boolean(global.indexedDB) && typeof global.Blob === "function";
	}

	function openDb() {
		if (dbPromise) {
			return dbPromise;
		}

		dbPromise = new Promise((resolve, reject) => {
			const request = global.indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: "id" });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error(fwT("galleryOpenFailed", "无法打开本地图片库")));
			request.onblocked = () => reject(new Error(fwT("galleryBlocked", "本地图片库被其他页面占用")));
		}).catch((error) => {
			dbPromise = null;
			throw error;
		});

		return dbPromise;
	}

	function runInTransaction(db, mode, run) {
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, mode);
			let request;
			try {
				request = run(transaction.objectStore(STORE_NAME));
			} catch (error) {
				reject(error);
				return;
			}

			transaction.oncomplete = () => resolve(request ? request.result : undefined);
			transaction.onabort = () => reject(transaction.error || new Error(fwT("galleryFailed", "本地图片库操作失败")));
			transaction.onerror = () => reject(transaction.error || new Error(fwT("galleryFailed", "本地图片库操作失败")));
		});
	}

	async function listImages() {
		const db = await openDb();
		const records = await runInTransaction(db, "readonly", (store) => store.getAll());
		return records.sort((a, b) => a.createdAt - b.createdAt);
	}

	async function getImage(id) {
		const db = await openDb();
		return runInTransaction(db, "readonly", (store) => store.get(id));
	}

	async function putImage(record) {
		const db = await openDb();
		await runInTransaction(db, "readwrite", (store) => store.put(record));
		return record;
	}

	async function deleteImage(id) {
		const db = await openDb();
		await runInTransaction(db, "readwrite", (store) => store.delete(id));
	}

	function createRecordId() {
		if (global.crypto && typeof global.crypto.randomUUID === "function") {
			return global.crypto.randomUUID();
		}

		return `bg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	}

	function decodeViaImageElement(file) {
		return new Promise((resolve, reject) => {
			const objectUrl = URL.createObjectURL(file);
			const image = new Image();
			image.onload = () => {
				URL.revokeObjectURL(objectUrl);
				resolve(image);
			};
			image.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error(fwT("imageReadFailed", "无法读取这张图片，请换一张试试")));
			};
			image.src = objectUrl;
		});
	}

	function decodeImageSource(file) {
		if (typeof global.createImageBitmap === "function") {
			return global.createImageBitmap(file).catch(() => decodeViaImageElement(file));
		}

		return decodeViaImageElement(file);
	}

	function releaseImageSource(source) {
		if (source && typeof source.close === "function") {
			source.close();
		}
	}

	function canvasToBlob(canvas, type, quality) {
		return new Promise((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) {
					resolve(blob);
					return;
				}

				reject(new Error(fwT("imageProcessFailed", "图片处理失败，请换一张试试")));
			}, type, quality);
		});
	}

	function createThumbDataUrl(sourceCanvas) {
		const scale = Math.min(1, THUMB_EDGE / Math.max(sourceCanvas.width, sourceCanvas.height));
		const thumbCanvas = document.createElement("canvas");
		thumbCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
		thumbCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));

		const context = thumbCanvas.getContext("2d");
		if (!context) {
			return "";
		}

		context.drawImage(sourceCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
		return thumbCanvas.toDataURL("image/jpeg", THUMB_QUALITY);
	}

	async function compressImage(file) {
		const source = await decodeImageSource(file);
		const sourceWidth = source.naturalWidth || source.width;
		const sourceHeight = source.naturalHeight || source.height;

		if (!sourceWidth || !sourceHeight) {
			releaseImageSource(source);
			throw new Error(fwT("imageReadFailed", "无法读取这张图片，请换一张试试"));
		}

		const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
		const width = Math.max(1, Math.round(sourceWidth * scale));
		const height = Math.max(1, Math.round(sourceHeight * scale));

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) {
			releaseImageSource(source);
			throw new Error(fwT("imageUnsupported", "当前浏览器无法处理这张图片"));
		}

		context.drawImage(source, 0, 0, width, height);
		releaseImageSource(source);

		const blob = await canvasToBlob(canvas, "image/webp", ENCODE_QUALITY);
		return {
			blob,
			width,
			height,
			thumb: createThumbDataUrl(canvas),
		};
	}

	async function addImage(file) {
		if (!isSupported()) {
			throw new Error(fwT("saveUnsupported", "当前浏览器不支持保存上传的图片"));
		}

		if (file.size > LIMITS.maxFileSize) {
			throw new Error(fwT("imageTooLarge", "图片文件过大，请选择 30MB 以内的图片"));
		}

		const db = await openDb();
		const existing = await runInTransaction(db, "readonly", (store) => store.getAll());
		if (existing.length >= LIMITS.maxImages) {
			throw new Error(fwT("galleryFull", "最多保存 {n} 张背景图，请先删除部分图片").replace("{n}", String(LIMITS.maxImages)));
		}

		const compressed = await compressImage(file);
		return putImage({
			id: createRecordId(),
			name: file.name || fwT("bgDefaultName", "背景图"),
			thumb: compressed.thumb,
			blob: compressed.blob,
			width: compressed.width,
			height: compressed.height,
			createdAt: Date.now(),
		});
	}

	global.FireworksBackgroundLibrary = Object.freeze({
		isSupported,
		listImages,
		getImage,
		addImage,
		deleteImage,
		LIMITS,
	});
})(window);
