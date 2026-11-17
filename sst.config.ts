/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "kebab-boxd",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "cloudflare",
      providers: { cloudflare: "6.23.1" },
    };
  },
  async run() {
    const zoneName = "kebab-boxd.com";
    const domain = zoneName;

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
        worker: (args) => {
          args.bindings = $output(args.bindings).apply((bindings) => [...(bindings ?? []), { type: "images", name: "Images" }]);
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
            worker: (args) => {
              const secretBindings = Object.entries(secrets).map(([name, secret]) => ({ type: "secret_text", name, text: secret.value }));
              const databaseBinding = {
                type: "durable_object_namespace",
                name: "Database",
                className: database.className,
                scriptName: backend.nodes.worker.scriptName,
              };
              args.bindings = $output(args.bindings).apply((bindings) => [...(bindings ?? []), ...secretBindings, databaseBinding]);
              args.cacheOptions = { enabled: true };
            },
          },
        },
      },
    });

    const zoneId = $app.stage === "production" ? cloudflare.getZoneOutput({ filter: { name: zoneName } }).zoneId : undefined;

    const alwaysUseHttps = zoneId
      ? new cloudflare.ZoneSetting("AlwaysUseHttps", { zoneId, settingId: "always_use_https", value: "on" })
      : undefined;

    const ssl = zoneId ? new cloudflare.ZoneSetting("Ssl", { zoneId, settingId: "ssl", value: "strict" }) : undefined;

    const bots =
      zoneId
        ? new cloudflare.BotManagement("BotManagement", {
            zoneId,
            aiBotsProtection: "block",
            fightMode: false,
            isRobotsTxtManaged: false,
          })
        : undefined;

    return { url: web.url, aiBots: bots?.aiBotsProtection, alwaysUseHttps: alwaysUseHttps?.value, ssl: ssl?.value };
  },
});
