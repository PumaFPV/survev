import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import enquirer from "enquirer";
import hjson from "hjson";
import { configFileName } from "./config";
import type { PartialConfig } from "./configType";
import { util } from "./shared/utils/util";

const prompt = enquirer.prompt;

async function importKeys(config: PartialConfig) {
    config.secrets ??= {};

    config.secrets.SURVEV_API_KEY = apiKey.value;

    config.secrets.SURVEV_LOADOUT_SECRET = loadoutSecret.value;
}

async function setupGameServer(config: PartialConfig) {
    config.gameServer ??= {};
    config.gameServer.thisRegion = "eu";

    config.regions ??= {};

    config.regions["eu"] = {
        https: false,
        address: "",
        l10n: "",
    };

    config.gameServer.apiServerUrl = "http://127.0.0.1:8000";

    await setupProxyIPHeader(config, "gameServer");
    await setupSSL(config, "gameServer");
}

async function setupDatabase(config: PartialConfig, initial = true) {

    config.database = {
        ...config.database,
        enabled: dbEnabled.value,
    };

    const setupBot = await prompt<{ value: boolean }>({
        message: "Would you like to setup the moderation bot?",
        name: "value",
        type: "confirm",
        initial: false,
    });

    await setupBotConfig(config);
}

async function setupAPIServer(config: PartialConfig) {
    const shouldImportKeys = await prompt<{ value: "import" | "random" }>({
        message:
            "Would you like to import the API and loadout secret keys or use random ones?",
        name: "value",
        type: "select",
        choices: ["import", "random"],
    });

    if (shouldImportKeys.value === "import") {
        await importKeys(config);
    }
    await setupProxyIPHeader(config, "apiServer");
    await setupSSL(config, "apiServer");
    await setupDatabase(config);
}

async function setupRegions(config: PartialConfig) {
    config.regions ??= {};

    let addRegion = true;
    while (addRegion) {
        const regionId = await prompt<{ value: string }>({
            message: "Enter region ID (eg: na, eu, sa, as)",
            name: "value",
            type: "text",
            required: true,
        });

        const https = await prompt<{ value: boolean }>({
            message: "Does this region support https?",
            name: "value",
            type: "confirm",
            initial: true,
        });

        const address = await prompt<{ value: string }>({
            message: "Enter region address",
            name: "value",
            type: "text",
        });

        const l10n = await prompt<{ value: string }>({
            message:
                "Enter region translation key (eg: index-north-america, index-south-america)",
            name: "value",
            type: "text",
        });

        config.regions[regionId.value] = {
            https: https.value,
            address: address.value,
            l10n: l10n.value,
        };

        const addMore = await prompt<{ value: boolean }>({
            message: "Would you like to add another region?",
            name: "value",
            type: "confirm",
            initial: false,
        });

        addRegion = addMore.value;
    }
}

async function setupProxyCheck(config: PartialConfig) {
    const enableProxyCheck = await prompt<{ value: boolean }>({
        message: "Would you like to enable proxycheck.io to ban VPNs and proxies?",
        name: "value",
        type: "confirm",
        initial: false,
    });
    if (enableProxyCheck.value) {
        const proxycheckKey = await prompt<{ value: string }>({
            message: "Enter proxycheck API key",
            name: "value",
            type: "text",
        });
        config.secrets ??= {};
        config.secrets.PROXYCHECK_KEY = proxycheckKey.value;
    }
}

async function setupProxyIPHeader(
    config: PartialConfig,
    server: "apiServer" | "gameServer",
) {
    const serverName = server == "apiServer" ? "API server" : "game server";
    const isBehindProxy = await prompt<{ value: boolean }>({
        message: `Is the ${serverName} behind a proxy? (e.g nginx or cloudflare)`,
        name: "value",
        type: "confirm",
        initial: false,
    });

    if (isBehindProxy.value) {
        const proxyHeader = await prompt<{ value: string }>({
            message: "Enter the proxy HTTP header",
            name: "value",
            type: "text",
            initial: "X-Real-IP",
        });
        config[server] ??= {};
        config[server].proxyIPHeader = proxyHeader.value;
    }
}

async function setupSSL(config: PartialConfig, server: "apiServer" | "gameServer") {
    const serverName = server == "apiServer" ? "API server" : "game server";

    const enableSSL = await prompt<{ value: boolean }>({
        message: `Would you like enabling SSL for the ${serverName}?`,
        name: "value",
        type: "confirm",
        initial: false,
    });

    if (enableSSL.value) {
        const keyFilePath = await prompt<{ value: string }>({
            message: "Enter SSL key file path",
            name: "value",
            type: "text",
        });
        const certFilePath = await prompt<{ value: string }>({
            message: "Enter SSL cert file path",
            name: "value",
            type: "text",
        });
        config[server] ??= {};
        config[server].ssl = {
            keyFile: keyFilePath.value,
            certFile: certFilePath.value,
        };
    }
}

async function setupProductionConfig(config: PartialConfig) {

        await setupGameServer(config);
        await importKeys(config);
    
    await setupProxyCheck(config);
}

async function setupDevelopmentConfig(config: PartialConfig) {
    await setupDatabase(config, false);
}

async function setupBotConfig(config: PartialConfig) {
    config.secrets ??= {};

    if (!config.secrets.DISCORD_CLIENT_ID) {
        const clientId = await prompt<{ value: string }>({
            message: "Enter discord client ID",
            name: "value",
            type: "text",
            required: true,
        });
        config.secrets.DISCORD_CLIENT_ID = clientId.value;
    }

    const discordBotToken = await prompt<{ value: string }>({
        message: "Enter the discord bot token",
        name: "value",
        type: "text",
    });
    config.secrets.DISCORD_BOT_TOKEN = discordBotToken.value;

    const discordGuildId = await prompt<{ value: string }>({
        message: "Enter the guild ID",
        name: "value",
        type: "text",
    });
    config.discordGuildId = discordGuildId.value;

    const discordRoleId = await prompt<{ value: string }>({
        message: "Enter the discord role ID",
        name: "value",
        type: "text",
    });
    config.discordRoleId = discordRoleId.value;
}

const configPath = path.join(import.meta.dirname, configFileName);

async function loadExistingConfig(config: PartialConfig) {
    if (!fs.existsSync(configPath)) return;

    const configText = fs.readFileSync(configPath).toString();
    const localConfig = hjson.parse(configText);
    util.mergeDeep(config, localConfig);
}

async function setupConfig() {
    const config: PartialConfig = {
        secrets: {
            SURVEV_API_KEY: randomBytes(64).toString("base64"),
            SURVEV_LOADOUT_SECRET: randomBytes(32).toString("base64"),
        },
    };

    console.log("Welcome to Survev.io initial config setup!");

    await loadExistingConfig(config);

    await setupProductionConfig(config);
    

    const str = hjson.stringify(config, { bracesSameLine: true, space: 2 });
    fs.writeFileSync(configPath, str);

    console.log("Wrote config to", configPath, ":");
    console.log(
        hjson.stringify(config, { bracesSameLine: true, space: 2, colors: true }),
    );
}

await setupConfig();
