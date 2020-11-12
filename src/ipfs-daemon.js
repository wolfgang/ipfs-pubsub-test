const Ctl = require("ipfsd-ctl");
const binPath = require("go-ipfs").path;
const ipfsHttpClient = require("ipfs-http-client");
const debug = require('debug');
const fs = require("fs-extra");
const path = require("path");


module.exports = class IpfsDaemon {
  static async create(opts = {}) {
    const daemon = new IpfsDaemon(opts);
    await daemon._createController();
    return daemon;
  }

  constructor(opts = {}) {
    this._opts = opts;
  }

  async start() {
    await this._startNode();
  }

  async stop() {
    await this._controller.stop();
  }

  get controller() {
    return this._controller;
  }

  get ipfs() {
    return this.controller.api;
  }

  async _createController() {
    debug.enable('ipfsd-ctl:daemon:stdout,ipfsd-ctl:daemon:stderr');
    this._controller = await Ctl.createController({
      ipfsHttpModule: ipfsHttpClient,
      ipfsBin: binPath().replace("app.asar", "app.asar.unpacked"),
      remote: false,
      disposable: false,
      test: false,
      args: ["--enable-pubsub-experiment"],

      ipfsOptions: this._opts.ipfsConfig
    });

    return this._controller.init();
  }

  async _startNode() {
    let attachedToExistingProcess = fs.pathExistsSync(this._apiFile());

    // First, we want to attach to a possibly running process
    try {
      await this._controller.start();
    } catch (err) {
      // If the process was killed externally, ipfsd will still think it is running
      // because of a stale file 'api' in the repo .. so if that is the case, we remove
      // that file and start again with a fresh process
      if (err.message.includes('ECONNREFUSED')) {
        console.warn("Daemon was probably killed externally ... starting a new one.");
        fs.removeSync(this._apiFile());
        await this._controller.start();
        attachedToExistingProcess = false;
      }
    }

    // If we attached to an existing process, we want to start again to
    // flush out any existing connections, etc
    if (attachedToExistingProcess) {
      console.warn("Stale daemon process detected ... restarting it.");
      // This stops the process but fails for stupid reasons
      try { await this._controller.stop(); } catch (_) {}
      await this._controller.start();
    }
  }

  async _showDebugInfos() {
    console.log("---- IPFS version: ", await this.ipfs.version());
    const peerInfos = await this.ipfs.swarm.addrs();
    console.log("----- Swarm Addresses:");
    peerInfos.forEach(info => {
      console.log("++ ", info.id);
      info.addrs.forEach(addr => console.log("++++ ", addr.toString()));
    });
  }

  _apiFile() {
    return path.join(this._opts.ipfsConfig.repo, 'api');
  }

}

