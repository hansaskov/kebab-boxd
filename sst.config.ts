/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "kebab-boxd",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "cloudflare",
    };
  },
  async run() {
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
        },
      },
    });

    const web = new sst.cloudflare.Astro("Web", {
      link: [backend],
      domain: $app.stage === "production" ? "kebab.hjemmet.net" : undefined,
      dev: { command: "pnpm dev" },
      transform: {
        server: {
          transform: {
            // astro:env reads the secrets from the bindings of the Worker under these names.
            worker: (args) => {
              const secretBindings = Object.entries(secrets).map(([name, secret]) => ({ type: "secret_text", name, text: secret.value }));
              args.bindings = $output(args.bindings).apply((bindings) => [...(bindings ?? []), ...secretBindings]);
            },
          },
        },
      },
    });

    return { url: web.url };
  },
});
