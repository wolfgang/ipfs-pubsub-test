const ipfsClient = require("ipfs-http-client");
const fs = require("fs-extra");
const IPFSDaemon = require("./ipfs-daemon");
const path = require("path");
const os = require("os");
const uuidv4 = require("uuid").v4;

const RepoDir1 = path.join(os.tmpdir(), ".ipfs-pubsub-test-1");
const RepoDir2 = path.join(os.tmpdir(), ".ipfs-pubsub-test-2");

async function runOneTest(number, total) {
  fs.rmdirSync(RepoDir1, {recursive: true});
  fs.rmdirSync(RepoDir2, {recursive: true});
  const daemon1 = await IPFSDaemon.create({ipfsConfig: testConfig1()});
  const daemon2 = await IPFSDaemon.create({ipfsConfig: testConfig2()});

  console.log(`[${number}/${total}] Start Daemons`)
  await daemon1.start();
  await daemon2.start();
  const ipfs1 = await ipfsClient({host: 'localhost', port: 5007, protocol: 'http'});
  const ipfs2 = await ipfsClient({host: 'localhost', port: 5008, protocol: 'http'});

  console.log("Peers daemon1:", (await ipfs1.swarm.peers()).map(info => info.peer));
  console.log("Peers daemon2:", (await ipfs2.swarm.peers()).map(info => info.peer));
  try {
    const result = await testPubSub(ipfs1, ipfs2, number, total);
    console.log(result);
  } catch (e) {
    console.error(e);
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
    await ipfs2.pubsub.subscribe(channel, msg => {
      dataReceived = JSON.parse(new TextDecoder().decode(msg.data));
    }, {timeout: 2000});

    await waitForPeers(ipfs1, channel, 10000);
    const peers1 = await ipfs1.pubsub.peers(channel);
    const peers2 = await ipfs2.pubsub.peers(channel);
    console.log("Pubsub peers daemon1:", peers1);
    console.log("Pubsub peers daemon2:", peers2);


    await ipfs1.pubsub.publish(channel, JSON.stringify({type: "transport_test"}), {timeout: 2000});

  } catch (e) {
    console.log("Error when exchanging messages:", e);
  }

  return new Promise((resolve, reject) => {
    waitFor(
      () => dataReceived,
      () => resolve(`--- [${number}/${total}] Transport test success: ${JSON.stringify(dataReceived)}`),
      (waitedMillis) => reject(`--- [${number}/${total}] Transport test failed after ${waitedMillis}ms`),
      5000
    );
  });
}

function waitForPeers(ipfs, channel, timeout = 2000) {
  return new Promise(async (resolve, reject) => {
    await wait(0);

    async function wait(waitedMillis) {
      if (waitedMillis >= timeout) return resolve();
      const peers = await ipfs.pubsub.peers(channel);
      if (peers.length > 0) return resolve();
      setTimeout(() => wait(waitedMillis + 100), 100);
    }
  });
}

function waitFor(pred, resolve, reject, timeoutMillis, waitedMillis = 0) {
  if (pred()) return resolve();
  if (waitedMillis >= timeoutMillis) return reject(waitedMillis);
  setTimeout(() => waitFor(pred, resolve, reject, timeoutMillis, waitedMillis + 10), 10);
}

async function runTests(n) {
  for (let i = 0; i < n; ++i) {
    await runOneTest(i + 1, n);
  }
}

(async () => await runTests(100))();


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
