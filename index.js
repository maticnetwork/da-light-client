const { default: axios } = require('axios')
const { join } = require('path')

const { Worker } = require('worker_threads')

const HTTPURI = 'http://localhost:9933'

const AskProofCount = 3
const MatrixDimX = 256
const MatrixDimY = 256

const workerScript = join(__dirname, './verifier_worker.js')

// Return random integer in specified range
// where lower bound is inclusive, but other end is not
const getRandomInt = (low, high) => {

    return Math.floor(Math.random() * (high - low)) + low

}

// Query for latest block header, in case of failure returns `null`
const getLatestBlockHeader = async _ => {

    try {

        const blockHeader = await axios.post(HTTPURI,
            {
                "id": 1,
                "jsonrpc": "2.0",
                "method": "chain_getHeader"
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        )

        return 'result' in blockHeader.data ? blockHeader.data.result : null

    } catch (e) {

        console.error(e.toString())
        return null

    }

}

// Given block number, get block hash
const fetchBlockHashByNumber = async num => {

    try {

        const blockHash = await axios.post(HTTPURI,
            {
                "id": 1,
                "jsonrpc": "2.0",
                "method": "chain_getBlockHash",
                "params": [num]
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        )

        return 'result' in blockHash.data ? blockHash.data.result : null

    } catch (e) {

        console.error(e.toString())
        return null

    }

}

// Given block hash, attempts to fetch block
const fetchBlockByHash = async hash => {

    try {

        const blockHeader = await axios.post(HTTPURI,
            {
                "id": 1,
                "jsonrpc": "2.0",
                "method": "chain_getBlock",
                "params": [hash]
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        )

        return 'result' in blockHeader.data ? blockHeader.data.result : null

    } catch (e) {

        console.error(e.toString())
        return null

    }

}

// Given block number, first fetch hash of block, then fetch block using hash
const fetchBlockByNumber = async num => {

    const hash = await fetchBlockHashByNumber(num)
    if (!hash) {
        return null
    }

    return await fetchBlockByHash(hash)

}

// Single cell verification job is submiited in a different thread of
// worker, using this function
const singleIterationOfVerification = (blockNumber, x, y, commitment) => {

    return new Promise(async (res, rej) => {

        try {

            const proof = await axios.post(HTTPURI,
                {
                    "id": 1,
                    "jsonrpc": "2.0",
                    "method": "kate_queryProof",
                    "params": [blockNumber, [{ "row": x, "col": y }]]
                },
                {
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            )

            const worker = new Worker(workerScript, {
                workerData: [x, y, commitment, proof.data.result]
            })

            worker.on('message', res)
            worker.on('error', rej)

        } catch (e) {
            rej(e)
        }

    })

}
// -- ends here


// Given a block, which is already fetched, attempts to
// verify block content by checking commitment & proof asked by
// cell indices
const verifyBlock = async block => {

    const blockNumber = block.block.header.number
    const commitment = block.block.header.extrinsicsRoot.commitment

    const _promises = []

    for (let i = 0; i < AskProofCount; i++) {

        const [x, y] = [getRandomInt(0, MatrixDimX), getRandomInt(0, MatrixDimY)]

        _promises.push(singleIterationOfVerification(blockNumber, x, y, commitment.slice(48 * x, x * 48 + 48)))

    }

    // Waiting for all verification iterations to finish
    const status = (await Promise.all(_promises)).reduce((acc, cur) => { acc[cur]++; return acc; }, { true: 0, false: 0 })

    console.log(`[+] Verified block with ${JSON.stringify(status)}`)

}

// Given block number range, fetches all of them & attempts to
// verify each of them
const processBlocksInRange = async (x, y) => {

    for (let i = x; i <= y; i++) {

        console.log(`[*] Processing block : ${i}`)

        const block = await fetchBlockByNumber(i)
        if (!block) {
            continue
        }

        await verifyBlock(block)
        console.log(`[+] Processed block : ${i}`)

    }

}

// Sleep for `t` millisecond
const sleep = t => {
    setTimeout(_ => { }, t)
}

// Main entry point, to be invoked for starting light client ops
const main = async _ => {

    let lastSeenBlock = 0

    while (1) {

        const block = await getLatestBlockHeader()
        if (!block) {
            sleep(3000)
            continue
        }

        // Parse block number in hex string format
        const blockNumber = parseInt(block.number)

        if (!(lastSeenBlock < blockNumber)) {
            sleep(6000)
            continue
        }

        await processBlocksInRange(lastSeenBlock + 1, blockNumber)
        lastSeenBlock = blockNumber

    }

}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
