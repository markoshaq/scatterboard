// Off-main-thread JSON codec for the workspace payload: the doc is
// structured-cloned in/out (cheap), the stringify/parse happens here.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; op: string; payload: unknown }>) => void) | null;
  postMessage(msg: unknown): void;
};

ctx.onmessage = (e) => {
  const { id, op, payload } = e.data;
  try {
    const out = op === 'stringify' ? JSON.stringify(payload) : JSON.parse(payload as string);
    ctx.postMessage({ id, out });
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
