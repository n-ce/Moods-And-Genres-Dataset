import { scrapeDataset } from "./pipeline";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const clean = args.includes("--clean");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limitPlaylists = limitArg
    ? parseInt(limitArg.split("=")[1] || "", 10)
    : undefined;
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg
    ? parseInt(concArg.split("=")[1] || "", 10)
    : undefined;

  try {
    await scrapeDataset({ clean, limitPlaylists, concurrency });
  } catch (error) {
    console.error("Fatal scraping error:", error);
    process.exit(1);
  }
}

export { scrapeDataset };
