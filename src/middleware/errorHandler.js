export function errorHandler(err, _req, res, _next) {
  console.error("Express Error Handler:", err);
  return res.status(400).json({ error: err.message || "An unexpected error occurred" });
}
