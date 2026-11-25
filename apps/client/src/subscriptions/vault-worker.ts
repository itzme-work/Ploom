import { seal, open } from "./crypto";
self.onmessage = async ({ data }) => {
	try {
		self.postMessage(
			await (data.op === "seal" ? seal : open)(data.value, data.password),
		);
	} catch {
		self.postMessage(null);
	}
};
