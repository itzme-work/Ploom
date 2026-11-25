import { parseSubscription } from "./parser";
self.onmessage = ({ data }) => {
	try {
		self.postMessage(parseSubscription(data));
	} catch {
		self.postMessage(null);
	}
};
