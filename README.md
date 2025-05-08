QDNBridge JSON

Designed to take an existing JSON source and publish to Qortal's QDN

<b>Configuration:</b>

<b>Files:</b>
Two (2) files are required to support the migration of JSON data.  A settings.json defines the model, defines sources, defines mappings and transforms and lastly defines publishing points.  The settings-pk.json contains the owner of the JSON data and the private key of the owner for publishing purposes
<li>settings.json</li>

```
model: a set of properties that will be constructed for each data member (next section)
data: an array of datas to process
  - name: idenitifier for the data set
  - sourceServers: array of servers to try and get data from
    - uri: URI to fetch the JSON from
    - valuesToMap: array of elements mapping of foreign JSON to the defined model
    - modifiers: array of elements to modify (direct JS)
targetServers: array of Qortal Core servers to publish QDN to 
```
<li>settings-pk.json</li>

```
{
  "owner":"YourPublishingName",
  "YourPublishingName":"PrivateKeyBase58"
}
```

<b>Execution:</b>

node QDNjsonbridge.js <settings.json>