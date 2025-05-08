import https from 'https';
import http from 'http';

const debug = false;

if (process.argv.length != 3 ) {
    console.error('You must pass a file name to process');
    console.error('  Example:', process.argv[0], process.argv[1], 'data.json');
    process.exit(1);
}

// Get Settings File
const settingsFile = process.argv[2];
import fs from 'fs';

let settings;
try {
    const rawData = fs.readFileSync(settingsFile, 'utf-8');
    settings = JSON.parse(rawData);
} catch (err) {
    console.error(`❌ Failed to load or parse settings file: ${err.message}`);
    process.exit(1);
}

let id;
const idPrefix = "coinInfo-";

// Get the Owner & PrivateKey from seperate file, index on owner
const index = settingsFile.length - 5; // Insert before .json
const privateKeyFile = settingsFile.slice(0, index) + '-pk' + settingsFile.slice(index);
let privateKeys;
try { 
    privateKeys = JSON.parse(fs.readFileSync(privateKeyFile, 'utf-8'));
} catch (err) {
    console.error(`❌ Failed to load or parse private key file: ${err.message}`);
    process.exit(1);
}
if (!privateKeys.hasOwnProperty("owner")) {
    console.error(`❌ File`, privateKeyFile, `is missing \"owner\" key`);
    process.exit(1);
}
let owner = privateKeys.owner;
if (!privateKeys.hasOwnProperty(owner)) {
    console.error(`❌ File`, privateKeyFile, `is missing \"`+owner+`\": \"YourPrivateKeyBase58\"`);
    process.exit(1);
}

let finalCoinData = {};      // Data Store for post to QDN
function isValidJSON(str) {
    try {
        const parsed = JSON.parse(str);
        return typeof parsed === 'object' && parsed !== null;
    } catch (e) {
        return false;
    }
}
function getCoinData(server, callback) {
    if (debug)
        console.log('Running getCoinData: ', server.uri)
    // Parse the uri to determine which module to use
    const getModule = server.uri.startsWith('https') ? https : http;

    const req = getModule.get(server.uri, (getRes) => {
        let data = '';
        
        // Read data in chunks
        getRes.on('data', chunk => {
            data += chunk;
        });

        // Once all data is received
        getRes.on('end', () => {
            if (debug)
                console.log('Received GET data complete:', data);
            try {
                const jsonCoinData = JSON.parse(data);
                callback(null, jsonCoinData);
            } catch (err) {
                console.error('Error Parsing JSON', err);
                callback(err);
            }
        });
    });

    req.setTimeout(5000, () => {
        console.error('Request Timed Out');
        req.abort();
        callback(new Error('Request Timed Out'));
    });

    req.on('error', (err) => {
        console.error('Request Error', err);
        callback(err);
    });
}
function getCoinDataPromise(server) {
    return new Promise((resolve, reject) => {
        getCoinData(server, (err, data) => {
            if (err) return reject(err);
            resolve(data);
        });
    });
}
function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

// Use the Model and Modifiers to manipulate the data to the format we want
function buildCoinBlock(rawCoinData, valuesToMap, modifiers) {
    const formattedCoinBlock = {
        //name: rawCoinData.name Duplicate Data now
    };
    for (const key in valuesToMap) {
        const mappedKey = valuesToMap[key];
        formattedCoinBlock[key] = mappedKey ? getNestedValue(rawCoinData, mappedKey) ?? null : null;
    }
    for (const modify in modifiers) {
        formattedCoinBlock[modify] = eval(`"${formattedCoinBlock[modify]}"${modifiers[modify]}`);
    }
    return formattedCoinBlock;
}

// Verify the coinData meets some basic requirements
function isValidCoinData(coinData) {
    let isValid = true;
    const now = Date.now();
    const twentyFourHoursInMs = 24 * 60 * 60 * 1000;

    try {
        if (!coinData.time || new Date(coinData.time).getTime() < (now - twentyFourHoursInMs)) {
            return false;
        }
    } catch {
        // Unable to correctly parse coinData.time
        return false;
    }

    // If we are missing all fee data
    if (coinData.low_fee_per_kb == null && coinData.medium_fee_per_kb == null && coinData.high_fee_per_kb == null)
        return false
    
    return isValid;
}

function setBestCoinData(bestCoinData, formattedCoinData) {
    if ( Object.keys(bestCoinData).length === 0 ) {     // If bestData is currently empty
        Object.assign(bestCoinData, formattedCoinData);
        return;
    }
}
function buildArbitraryJSONTX(id, JSONData, APIServer, owner = {}) {
    console.log('owner', owner)
    return new Promise((resolve, reject) => {
        // Format for API Call '/arbitrary/JSON/ + ownerName + / + identifier + /string'
        const uri = APIServer.uri + "arbitrary/JSON/" + owner + "/" + id + "/string" + "?fee=1000000";

        if(debug)
            console.log(uri);
        const JSONString = JSON.stringify(JSONData, null, 2); 
        const putModule = APIServer.uri.startsWith('https') ? https : http;

        const putOptions = {
            method: 'POST',
            headers: {
                'X-API-KEY': APIServer.apiKey,
                'Content-Type': 'text/plain',
                'Content-Length': Buffer.byteLength(JSONString)
            }
        };

        const putReq = putModule.request(uri, putOptions, (putRes) => {
            let putResData = '';
            putRes.on('data', chunk => putResData += chunk);
            putRes.on('end', () => {
                resolve({"body": putResData, "statusCode":putRes.statusCode });
                console.log(putOptions.method, ' response:', putResData);
                console.log('Status Code:', putRes.statusCode);
            });
        });

        putReq.on('error', reject);

        // Send the data
        putReq.write(JSONString);
        putReq.end();
    });
}
function signTX(TXData, APIServer, privateKey = {}) {
    return new Promise((resolve, reject) => {
        
        const uri = APIServer.uri + "transactions/sign";
        if (debug)
            console.log(uri);

        const putModule = APIServer.uri.startsWith('https') ? https : http;

        const putOptions = {
            method: 'POST',
            headers: {
                'accept': 'text/plain',
                'Content-Type': 'application/json'
            }
        };

        const putReq = putModule.request(uri, putOptions, (putRes) => {
            let putResData = '';
            putRes.on('data', chunk => putResData += chunk);
            putRes.on('end', () => {
                resolve({ "body": putResData, "statusCode": putRes.statusCode });
                console.log(putOptions.method,' response:', putResData);
                console.log('Status Code:', putRes.statusCode);
            });
        });

        putReq.on('error', reject);
            
        let JSONData = {
            "privateKey": privateKey,
            "transactionBytes": TXData
        };

        const JSONString = JSON.stringify(JSONData, null, 2);

        // Send the data
        console.log(JSONString);
        putReq.write(JSONString);

        putReq.end();
    });
}
function TXAction(TX, APIServer, method = {}) {
    return new Promise((resolve, reject) => {
        /* Format: transactions/process (post)
        {  // body
            "transactionBytes": "base58"
        }*/

        const uri = APIServer.uri + "transactions/" + method;
        if (debug)
            console.log(uri);

        const putModule = APIServer.uri.startsWith('https') ? https : http;

        const putOptions = {
            method: 'POST',
            headers: {
                'accept': 'text/plain',
                'Content-Type': 'text/plain'
            }
        };

        const putReq = putModule.request(uri, putOptions, (putRes) => {
            let putResData = '';
            putRes.on('data', chunk => putResData += chunk);
            putRes.on('end', () => {
                resolve({ "body": putResData, "statusCode": putRes.statusCode });
                console.log(putOptions.method, 'response:', putResData);
                console.log('Status Code:', putRes.statusCode);
            });
        });

        putReq.on('error', reject);

        // Send the data
        putReq.write(TX);
        putReq.end();
    });
}

// Loop through all the coins
for (const coin of settings.data) { 
    // Dump the information about our Coins
    if (debug) {
        console.log(`  Name: ${coin.name}`);
        console.log(`  Source Server Count: ${(coin.sourceServers).length}`);
        coin.sourceServers.forEach((server, index) => {
            console.log(`  Source Server: ${index + 1}`);
            console.log(`    Server Address: ${server.uri}`);
            console.log(`    Server Values`);
            console.log(`      Value height: ${server.valuesToMap.height}`);
            console.log(`      Value time: ${server.valuesToMap.time}`);
            console.log(`      Value low_fee_per_kb: ${server.valuesToMap.low_fee_per_kb}`);
            console.log(`      Value medium_feer_per_kb: ${server.valuesToMap.medium_fee_per_kb}`);
            console.log(`      Value high_fee_per_kb: ${server.valuesToMap.high_fee_per_kb}`);
        });
        console.log(``);
    }

    let bestCoinData = { };
    for (const server of coin.sourceServers) {
        try {
            const rawCoinData = await getCoinDataPromise(server);

            if (debug)
                console.log('rawCoinData:', rawCoinData);
            rawCoinData.name = coin.name;
            const formattedCoinData = buildCoinBlock(rawCoinData, server.valuesToMap, server.modifiers);
            if (debug)
                console.log('formattedCoinData: ', JSON.stringify(formattedCoinData, null, 2));

            // Validate block
            if (isValidCoinData(formattedCoinData)) {
                formattedCoinData.time = new Date(formattedCoinData.time).getTime();
                // Check if this new result is better than the last
                setBestCoinData(bestCoinData, formattedCoinData);
            } else {
                console.log('Rejected result for: ', server.uri);
            }

            // Push onto final stack
        } catch (err) {
            console.error('Server Error:', err.message);
        }
    }  // Done looping through servers for a coin

    // Add bestData to Final Data
    //finalCoinData[coin.name] = bestCoinData; no longer require encapsulation in <COIN> : { data }
    finalCoinData = bestCoinData;
    id = idPrefix + coin.name;
} // Done with all Coins
if (debug)
    console.log("FinalCoinData: \n",JSON.stringify(finalCoinData, null, 2));

// Construct Transaction for QDN
id = id + "-" + Math.floor(Date.now() / 1000).toString();

process.exit(0);

let rawTX = '';
for (const server of settings.targetServers) {
    if (rawTX.length === 0 || rawTX.statusCode !== 200) {
        rawTX = await buildArbitraryJSONTX(id, finalCoinData, server, owner);
    } 
}
console.log('rawTX: ', rawTX);
// Remove the Status Code
rawTX = rawTX.body;

let privateKey = privateKeys[owner];
if (privateKey === undefined) {
    console.error("Missing Private Key, see:", privateKeyFile);
    process.exit(1);
}

// Sign the transaction
let signedTX = '';    
for (const server of settings.targetServers) {
    if (signedTX.length === 0 || signedTX.statusCode !== 200) {
        signedTX = await signTX(rawTX, server, privateKey);
    }
}
if (signedTX.statusCode !== 200) {
    console.error('Error Signing TX')
    process.exit(1);
}
signedTX = signedTX.body;

console.log('signedTX: ',signedTX);

let statusCode = 301;
let finalResult = '';
for (const server of settings.targetServers) {
    if (statusCode !== 200) {
        let processedTX = await TXAction(signedTX, server, "process");
        statusCode = processedTX.statusCode;
        finalResult = processedTX.body;
    }
}

if (signedTX.statusCode === 200)
    console.log('Final:', finalResult);

console.log('All Done');
// Done Posting to QDN
