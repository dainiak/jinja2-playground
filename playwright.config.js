// @ts-check
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	testIgnore: "**/unit/**",
	timeout: 60_000,
	expect: { timeout: 30_000 },
	fullyParallel: false,
	retries: 0,
	reporter: "html",
	use: {
		baseURL: "http://localhost:3737",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
	webServer: {
		command: "npx vite --port 3737",
		url: "http://localhost:3737",
		reuseExistingServer: !process.env.CI,
	},
});
