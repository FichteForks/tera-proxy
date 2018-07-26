const DiscordURL = "https://discord.gg/maqBmJV";
const {region: REGION, updatelog: UPDATE_LOG, updatelimit: UPDATE_LIMIT, dnsservers: DNS_SERVERS} = (() => {
    try {
        return require("../config.json");
    } catch(_) {
        console.log("ERROR: Whoops, looks like you've fucked up your config.json!");
        console.log("ERROR: Try to fix it yourself or ask in the #help channel of %s!", DiscordURL);
        process.exit(1);
    }
})();

const REGIONS = require("./regions");
const currentRegion = REGIONS[REGION];
const isConsole = currentRegion["console"];
const { customServers, listenHostname, hostname } = currentRegion;
const fs = require("fs");
const path = require("path");

if (!currentRegion) {
  console.error("Unsupported region: " + REGION);
  return;
} else {
  // Region migration
  let migratedFile = null;
  switch(REGION) {
    case "EU": {
      if ((currentRegion.customServers["30"] && currentRegion.customServers["30"].name == "(EN) - Sikander (Proxy)") ||
          (currentRegion.customServers["31"] && currentRegion.customServers["31"].name == "(DE) - Saleron (Proxy)") ||
          (currentRegion.customServers["32"] && currentRegion.customServers["32"].name == "(FR) - Amarun (Proxy)") ||
          (currentRegion.customServers["33"] && currentRegion.customServers["33"].name == "(INT) - Manahan (Proxy)") ||
          !currentRegion.customServers["34"] ||
          !currentRegion.customServers["35"])
        migratedFile = "res/servers-eu.json";
      break;
    }
    case "TH": {
      if ((currentRegion.customServers["1"] && currentRegion.customServers["1"].name == "Karas (Proxy)") ||
          (currentRegion.customServers["2"] && currentRegion.customServers["2"].name == "Zuras (Proxy)"))
        migratedFile = "res/servers-th.json";
      break;
    }
  }

  if (migratedFile) {
    try {
      fs.unlinkSync(path.join(__dirname, migratedFile));
      console.log(`Due to a change in the server list by the publisher, your server configuration for region ${REGION} was reset. Please restart proxy for the changes to take effect!`);
    } catch (e) {
      console.log(`ERROR: Unable to migrate server list for region ${REGION}: ${e}`);
    }
    return;
  }

  // No migration required
  console.log(`[sls] Tera-Proxy configured for region ${REGION}!`);
}

let why;
try { why = require("why-is-node-running"); }
catch (_) {}

const net = require("net");
const dns = require("dns");
const hosts = require("./hosts");

if (!isConsole) {
  try { hosts.remove(listenHostname, hostname); }
  catch (e) {
    switch (e.code) {
     case "EACCES":
      console.error(`ERROR: Hosts file is set to read-only.

  * Make sure no anti-virus software is running.
  * Locate "${e.path}", right click the file, click 'Properties', uncheck 'Read-only' then click 'OK'.`);
      break;
     case "EBUSY":
      console.error(`ERROR: Hosts file is busy and cannot be written to.

  * Make sure no anti-virus software is running.
  * Try deleting "${e.path}".`);
      break;
     case "EPERM":
      console.error(`ERROR: Insufficient permission to modify hosts file.

  * Make sure no anti-virus software is running.
  * Right click TeraProxy.bat and select 'Run as administrator'.`);
      break;
     case "ENOENT":
      console.error(`ERROR: Unable to write to hosts file.

  * Make sure no anti-virus software is running.
  * Right click TeraProxy.bat and select 'Run as administrator'.`);
      break;
     default:
      throw e;
    }

    return;
  }
}

const moduleBase = path.join(__dirname, "..", "node_modules");
let modules;

function populateModulesList() {
  modules = [];
  for (let i = 0, k = -1, arr = fs.readdirSync(moduleBase), len = arr.length; i < len; ++i) {
    const name = arr[i];
    if (name[0] === "." || name[0] === "_")
      continue;
    if (!name.endsWith(".js") && !fs.lstatSync(path.join(moduleBase, name)).isDirectory())
      continue;
    modules[++k] = name;
  }
}


const servers = new Map();

function customServerCallback(server) {
  const { address, port } = server.address();
  console.log(`[game] listening on ${address}:${port}`);
}

function listenHandler(err) {
  if (err) {
    const { code } = err;
    if (code === "EADDRINUSE") {
      console.error("ERROR: Another instance of TeraProxy is already running, please close it then try again.");
      process.exit();
    }
    else if (code === "EACCES") {
      let port = currentRegion.port;
      console.error("ERROR: Another process is already using port " + port + ".\nPlease close or uninstall the application first:");
      return require("./netstat")(port);
    }
    throw err;
  }

  if (!isConsole) {
    hosts.set(listenHostname, hostname);
    console.log("[sls] server list overridden");
  }

  for (let i = servers.entries(), step; !(step = i.next()).done; ) {
    const [id, server] = step.value;
    const currentCustomServer = customServers[id];

    server.listen(currentCustomServer.port, currentCustomServer.ip || "127.0.0.1", customServerCallback.bind(null, server));
  }
}

let lastUpdateResult = {"protocol_data": {}, "failed": [], "legacy": [], "updated": []};

function onConnectionError(err) {
  switch(err.code) {
    case 'ETIMEDOUT':
      console.error(`ERROR: Unable to connect to game server at ${err.address}:${err.port} (timeout)! Common reasons for this are:`);
      console.error("- An unstable internet connection or a geo-IP ban");
      console.error("- Game server maintenance");
      break;
    case 'ECONNRESET':
    case 'EPIPE':
      console.error(`ERROR: ${err.code} - Connection to game server was closed unexpectedly. Common reasons for this are:`);
      console.error("- A disconnect caused by an unstable internet connection");
      console.error("- An exploit/cheat or broken module that got you kicked");
      break;
    default:
      console.warn(err);
      break;
  }
}

function runServ(target, socket) {
  const { Connection, RealClient } = require("tera-proxy-game");

  const connection = new Connection({
    "console": isConsole,
    "protocol_data": lastUpdateResult["protocol_data"],
  });
  const client = new RealClient(connection, socket);
  const srvConn = connection.connect(client, {
    host: target.ip,
    port: target.port
  });

  // Load modules
  for (let name of lastUpdateResult["failed"])
    console.log("WARNING: Module %s could not be updated and will not be loaded!", name);
  for (let name of lastUpdateResult["legacy"])
    console.log("WARNING: Module %s does not support auto-updating!", name);

  let versioncheck_modules = lastUpdateResult["legacy"].slice(0);
  for (let module_data of lastUpdateResult["updated"]) {
    if (module_data["load_on"] === "connect")
      connection.dispatch.load(module_data["name"], module);
    else if(module_data["load_on"] === "versioncheck")
      versioncheck_modules.push(module_data["name"]);
  }

  connection.dispatch.on("init", () => {
    for (let name of versioncheck_modules)
      connection.dispatch.load(name, module);
  });

  // Initialize server connection
  let remote = "???";

  socket.on("error", onConnectionError);

  srvConn.on("connect", () => {
    remote = socket.remoteAddress + ":" + socket.remotePort;
    console.log("[connection] routing %s to %s:%d", remote, srvConn.remoteAddress, srvConn.remotePort);
  })

  srvConn.on("error", onConnectionError);

  srvConn.on("close", () => {
    console.log("[connection] %s disconnected", remote);
    console.log("[proxy] unloading user modules");
    for (let i = 0, arr = Object.keys(require.cache), len = arr.length; i < len; ++i) {
      const key = arr[i];
      if (key.startsWith(moduleBase)) {
        delete require.cache[key];
      }
    }
  })
}

const autoUpdate = require("./update");

function createServ(target, socket) {
  socket.setNoDelay(true);

  populateModulesList();
  runServ(target, socket);
}

const SlsProxy = require("tera-proxy-sls");
const proxy = new SlsProxy(currentRegion);

function startProxy() {  
  if(!isConsole) {
    dns.setServers(DNS_SERVERS || ["8.8.8.8", "8.8.4.4"]);

    proxy.fetch((err, gameServers) => {
      if (err) {
        console.error(`ERROR: Unable to load the server list: ${err}`);
        console.error("This is almost always caused by");
        console.error(" - your setup (invasive virus scanners, viruses, ...)");
        console.error(" - your internet connection (unstable/broken connection, improper configuration, geo-IP ban from the game region you're trying to play on, ...)");
        console.error(" - game servers being down for maintenance");
        console.error("Please test if you can regularly play the game (without proxy). If you can't, it's not a proxy issue, but one of the above.");
        process.exit(1);
      }

      for (let i = 0, arr = Object.keys(customServers), len = arr.length; i < len; ++i) {
        const id = arr[i];
        const target = gameServers[id];
        if (!target) {
          console.error(`[sls] WARNING: Server ${id} not found`);
          continue;
        }

        const server = net.createServer(createServ.bind(null, target));
        servers.set(id, server);
      }
      proxy.listen(listenHostname, listenHandler);
    });
  } else {
    for (let i = 0, arr = Object.keys(customServers), len = arr.length; i < len; ++i) {
      const id = arr[i];
      const target = customServers[id]["remote"];

      const server = net.createServer(createServ.bind(null, target));
      servers.set(id, server);
    }

    listenHandler();
  }
  
  // TODO: this is a dirty hack, implement this stuff properly
  for (let module_data of lastUpdateResult["updated"]) {
    if (module_data["load_on"] === "startup") {
      console.log(`[proxy] Initializing module ${module_data["name"]}`);
      require(module_data["name"]);
    }
  }
}

populateModulesList();
autoUpdate(moduleBase, modules, UPDATE_LOG, UPDATE_LIMIT).then((updateResult) => {
  if(!updateResult["tera-data"])
    console.log("WARNING: There were errors updating tera-data. This might result in further errors.");
  
  delete require.cache[require.resolve("tera-data-parser")];
  delete require.cache[require.resolve("tera-proxy-game")];
  
  lastUpdateResult = updateResult;
  startProxy();
}).catch((e) => {
  console.log("ERROR: Unable to auto-update: %s", e);
})

const isWindows = process.platform === "win32";

function cleanExit() {
  console.log("terminating...");

  if(!isConsole) {
    try { hosts.remove(listenHostname, hostname); }
    catch (_) {}

    proxy.close();
  }

  for (let i = servers.values(), step; !(step = i.next()).done; )
    step.value.close();

  if (isWindows) {
    process.stdin.pause();
  }

  setTimeout(() => {
    why && why();
    process.exit();
  }, 5000).unref();
}

if (isWindows) {
  require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  }).on("SIGINT", () => process.emit("SIGINT"));
}

process.on("SIGHUP", cleanExit);
process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
