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
    const zoneName = "kebab-boxd.com";
    const domain = zoneName;

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

    // The settings below belong to the zone, so they apply to every site of the zone, not only to this one.
    const zoneId = $app.stage === "production" ? cloudflare.getZoneOutput({ filter: { name: zoneName } }).zoneId : undefined;

    // Cloudflare sends a visitor who asks for http:// to https://.
    const alwaysUseHttps = zoneId
      ? new cloudflare.ZoneSetting("AlwaysUseHttps", { zoneId, settingId: "always_use_https", value: "on" })
      : undefined;

    // Cloudflare accepts only a valid certificate from the origin.
    const ssl = zoneId ? new cloudflare.ZoneSetting("Ssl", { zoneId, settingId: "ssl", value: "strict" }) : undefined;

    // Cloudflare turns away the crawlers of AI companies.
    const bots =
      zoneId
        ? new cloudflare.BotManagement("BotManagement", {
            zoneId,
            aiBotsProtection: "block",
            // Bot Fight Mode needs the JavaScript detections of Cloudflare, a script on every page, which the site
            // does without and its Content-Security-Policy refuses.
            fightMode: false,
            // The site writes its own robots.txt.
            isRobotsTxtManaged: false,
          })
        : undefined;

    return { url: web.url, aiBots: bots?.aiBotsProtection, alwaysUseHttps: alwaysUseHttps?.value, ssl: ssl?.value };
  },
});
