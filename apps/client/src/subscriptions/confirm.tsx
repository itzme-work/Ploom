import { useState, useRef, useEffect } from "react";
export function useConfirmation(ru: boolean) {
	const [message, set] = useState("");
	const answer = useRef<((ok: boolean) => void) | undefined>(undefined);
	const dialog = useRef<HTMLDialogElement>(null);
	const finish = (ok: boolean) => {
		answer.current?.(ok);
		answer.current = undefined;
		set("");
	};
	useEffect(() => {
		if (message) dialog.current?.showModal();
	}, [message]);
	useEffect(
		() => () => {
			answer.current?.(false);
		},
		[],
	);
	const ask = (message: string) =>
		new Promise<boolean>((resolve) => {
			answer.current?.(false);
			answer.current = resolve;
			set(message);
		});
	return {
		ask,
		prompt: message ? (
			<dialog ref={dialog} onCancel={() => finish(false)} aria-label={message}>
				<p>{message}</p>
				<button autoFocus onClick={() => finish(false)}>
					{ru ? "Отмена" : "Cancel"}
				</button>
				<button onClick={() => finish(true)}>
					{ru ? "Подтвердить" : "Confirm"}
				</button>
			</dialog>
		) : null,
	};
}
