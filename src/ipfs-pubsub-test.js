const fs = require("fs-extra");
const Ctl = require("ipfsd-ctl");
const binPath = require("go-ipfs").path;
const ipfsClient = require("ipfs-http-client");

const path = require("path");
const os = require("os");
const debug = require("debug");
const uuidv4 = require("uuid").v4;

const RepoDir1 = path.join(os.tmpdir(), ".ipfs-pubsub-test-1");
const RepoDir2 = path.join(os.tmpdir(), ".ipfs-pubsub-test-2");

(async () => await runTests(100))();

async function runTests(n) {
  // debug.enable('ipfsd-ctl:daemon:stdout,ipfsd-ctl:daemon:stderr,ipfs-http-client:pubsub:subscribe');
  for (let i = 0; i < n; ++i) {
    await runOneTest(i + 1, n);
  }
}

async function runOneTest(number, total) {
  fs.rmdirSync(RepoDir1, {recursive: true});
  fs.rmdirSync(RepoDir2, {recursive: true});
  const daemon1 = await createNode(testConfig1());
  const daemon2 = await createNode(testConfig2());

  console.log(`[${number}/${total}] Start Daemons`)
  await daemon1.start();
  await daemon2.start();

  await sleep(500);

  const ipfs1 = await ipfsClient({host: 'localhost', port: 5007, protocol: 'http'});
  const ipfs2 = await ipfsClient({host: 'localhost', port: 5008, protocol: 'http'});

  console.log("Peers daemon1:", (await ipfs1.swarm.peers()).map(info => info.peer));
  console.log("Peers daemon2:", (await ipfs2.swarm.peers()).map(info => info.peer));
  try {
    const result = await testPubSub(ipfs1, ipfs2, number, total);
    console.log(result);
  } catch (e) {
    console.error(e);
    await daemon1.stop();
    await daemon2.stop();

    process.exit(1);
  }
  console.log(`[${number}/${total}] Stop Daemons`)
  await daemon1.stop();
  await daemon2.stop();
}

async function testPubSub(ipfs1, ipfs2, number, total) {
  const channel = uuidv4();
  let dataReceived;
  try {
    await ipfs1.pubsub.subscribe(channel, msg => {
      dataReceived = JSON.parse(new TextDecoder().decode(msg.data));
    });

    console.log("Waiting for pubsub peers...");
    await waitForPubsubPeers(ipfs2, channel, 5000);
    const peers1 = await ipfs1.pubsub.peers(channel);
    const peers2 = await ipfs2.pubsub.peers(channel);
    console.log("Pubsub peers daemon1:", peers1);
    console.log("Pubsub peers daemon2:", peers2);
    if (peers2.length === 0) {
      console.log("Pubsub peers not set correctly. Failure imminent.")
    }

    await ipfs2.pubsub.publish(channel, JSON.stringify({type: "pubsub_test"}));

  } catch (e) {
    console.log("Error while exchanging messages:", e);
  }

  return new Promise(async (resolve, reject) => {
    await waitFor(
      () => dataReceived,
      () => resolve(`--- [${number}/${total}] Pubsub test success: ${JSON.stringify(dataReceived)}`),
      (waitedMillis) => reject(`--- [${number}/${total}] Pubsub test failed after ${waitedMillis}ms`),
      5000
    );
  });
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function waitForPubsubPeers(ipfs, channel, timeout = 2000) {
  return new Promise(async resolve => {
    await waitFor(
      async () => {
        const peers = await ipfs.pubsub.peers(channel);
        return peers.length > 0;
      },
      resolve, resolve, timeout
    );
  });
}

async function waitFor(pred, onSuccess, onTimeout, timeoutMillis, waitedMillis = 0) {
  if (await pred()) return onSuccess();
  if (waitedMillis >= timeoutMillis) return onTimeout(waitedMillis);
  setTimeout(() => waitFor(pred, onSuccess, onTimeout, timeoutMillis, waitedMillis + 100), 100);
}


async function createNode(ipfsOptions) {
  const node = await Ctl.createController({
    ipfsHttpModule: ipfsClient,
    ipfsBin: binPath().replace("app.asar", "app.asar.unpacked"),
    remote: false,
    disposable: false,
    test: false,
    args: ["--enable-pubsub-experiment"],
    ipfsOptions
  });

  return node.init();
}


function testConfig1() {
  return {
    repo: RepoDir1,
    config: {
      Bootstrap: [],
      Addresses: {
        Swarm: [
          '/ip4/0.0.0.0/tcp/4007',
          '/ip4/127.0.0.1/tcp/4008/ws'
        ],
        API: '/ip4/127.0.0.1/tcp/5007',
        Gateway: '/ip4/127.0.0.1/tcp/9595'
      },
    }
  }
}

function testConfig2() {
  return {
    repo: RepoDir2,
    config: {
      Bootstrap: [],
      Addresses: {
        Swarm: [
          '/ip4/0.0.0.0/tcp/4009',
          '/ip4/127.0.0.1/tcp/4010/ws'
        ],
        API: '/ip4/127.0.0.1/tcp/5008',
        Gateway: '/ip4/127.0.0.1/tcp/9696'
      },
    }
  }
}
