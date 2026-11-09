/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "kebab-boxd",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "cloudflare",
      // SST ships an older one, which cannot turn on the cache of a Worker.
      providers: { cloudflare: "6.23.1" },
    };
  },
  async run() {
    const zoneName = "hjemmet.net";
    const domain = `kebab.${zoneName}`;

    // Set each one for a stage with `sst secret set <name> <value> --stage <stage>`.
    const secrets = {
      GOOGLE_CLIENT_ID: new sst.Secret("GoogleClientId"),
      GOOGLE_CLIENT_SECRET: new sst.Secret("GoogleClientSecret"),
      GOOGLE_REDIRECT_URI: new sst.Secret("GoogleRedirectUri"),
      DATA_CONTROLLER_NAME: new sst.Secret("DataControllerName"),
      DATA_CONTROLLER_EMAIL: new sst.Secret("DataControllerEmail"),
      BOOTSTRAP_ADMIN_EMAIL: new sst.Secret("BootstrapAdminEmail"),
    };

    const pictures = new sst.cloudflare.Bucket("Pictures");
    const database = new sst.cloudflare.DurableObject("Database", { className: "DatabaseObject" });

    const backend = new sst.cloudflare.Worker("Backend", {
      handler: "src/backend.ts",
      link: [pictures, database],
      migrations: [{ tag: "v1", newSqliteClasses: ["DatabaseObject"] }],
      build: { loader: { ".sql": "text" } },
      transform: {
        // SST has no component for Cloudflare Images, which turns uploads into WebP pictures.
        worker: (args) => {
          args.bindings = $output(args.bindings).apply((bindings) => [...(bindings ?? []), { type: "images", name: "Images" }]);
          // Workers Logs keeps what the Durable Object logs, such as the rows each database call reads.
          args.observability = { enabled: true };
        },
      },
    });

    const web = new sst.cloudflare.Astro("Web", {
      link: [backend],
      domain: $app.stage === "production" ? domain : undefined,
      dev: { command: "pnpm dev" },
      transform: {
        server: {
          transform: {
            // astro:env reads the secrets from the bindings of the Worker under these names.
            worker: (args) => {
              const secretBindings = Object.entries(secrets).map(([name, secret]) => ({ type: "secret_text", name, text: secret.value }));
              args.bindings = $output(args.bindings).apply((bindings) => [...(bindings ?? []), ...secretBindings]);
              // Cloudflare keeps the pages that every Visitor sees, as src/middleware/visitor-cache.ts tells it.
              // Astro writes this into wrangler.json, which SST does not read.
              args.cacheOptions = { enabled: true };
            },
          },
        },
      },
    });

    // Cloudflare turns away the crawlers of AI companies. This is a setting of the zone, so it applies to every site
    // of the zone, not only to this one.
    const bots =
      $app.stage === "production"
        ? new cloudflare.BotManagement("BotManagement", {
            zoneId: cloudflare.getZoneOutput({ filter: { name: zoneName } }).zoneId,
            aiBotsProtection: "block",
            // Bot Fight Mode needs the JavaScript detections of Cloudflare, a script on every page, which the site
            // does without and its Content-Security-Policy refuses.
            fightMode: false,
            // The site writes its own robots.txt.
            isRobotsTxtManaged: false,
          })
        : undefined;

    return { url: web.url, aiBots: bots?.aiBotsProtection };
  },
});
