// Include client libraries
const Sync9C = require('./lib/client/sync9_client')
const ShareDBC = require('./lib/client/sharedb_client')
const AutomergeC = require('./lib/client/automerge_client')
const DiffSync = require('./lib/diffsync')
// Include util libraries
const pu = require('./lib/patch')
const clone = require('clone')
// Figure out which algorithm we're supposed to use
const urlParams = new URLSearchParams(window.location.search);

var c_funcs;
var c_name;
var switch_alg;
if (urlParams.has("sharedb")) {
    c_funcs = ShareDBC;
    c_name = "ShareDB";
    switch_alg = "sync9";

}
else if (urlParams.has("automerge")) {
    c_funcs = AutomergeC;
    c_name = "Automerge";
    switch_alg = "sync9";
}
else {
    c_funcs = Sync9C;
    c_name = "Sync9";
    switch_alg = "sharedb";
}
var alg = document.getElementById('alg')
alg.innerHTML = c_name
alg.href = location.protocol + '//' + location.host + location.pathname + '?' + switch_alg;

// Set up DOM elements
const textarea = document.querySelector('textarea');
const statusSpan = document.getElementById('status-span');
const console_output = document.getElementById('console');

statusSpan.innerHTML = "Not Connected";
textarea.style.backgroundColor = "gray";

// Set up the socket
const socket_url = 'ws://invisible.college:1200/interoperability'
const socket = new c_funcs.Socket(socket_url);

socket.console = function(orig, trans, outgoing) {
    var orig_text = clone(orig)
    if (typeof(orig) != "string")
        orig_text = JSON.stringify(orig, (k, v) => {if (k != "server_text") return v})
    else if (orig != "(No Original)") {
        orig_text = JSON.stringify(JSON.parse(orig), (k, v) => {if (k != "server_text") return v})
    }
    if (trans) {
        var trans_text = clone(trans)
        if (typeof(trans) != "string")
            trans_text = JSON.stringify(trans)
    }
    
    // Now we know what the original message was, whether we translated it
    // and whether we're sending or receiving it
    var msg = document.createElement('li');
    msg.className = outgoing ? "send" : "receive";
    var t = orig_text
    if (trans)
        t += " ⟶ " + trans_text
    msg.innerText = t;

    var scroll = console_output.scrollTop - (console_output.scrollHeight - console_output.clientHeight);

    console_output.appendChild(msg)

    if (scroll > -5)
        console_output.scrollTop = console_output.scrollHeight - console_output.clientHeight;
}

// Update DOM with socket status
socket.addEventListener('open', function() {
    statusSpan.innerHTML = "Connected";
    statusSpan.style.color="black";
    textarea.style.backgroundColor = "white";
    textarea.style.borderColor = "#999"
})

socket.addEventListener('close', function() {
    statusSpan.innerHTML = "Closed";
    statusSpan.style.color="black";
    textarea.style.backgroundColor = "gray";
    textarea.style.borderColor = "black";
});

global.sync = function(s) {
    if (s === true) {
        statusSpan.innerHTML = "In sync with server";
        statusSpan.style.color="green";
        textarea.style.backgroundColor = "hsl(120, 60%, 85%)";
        textarea.style.borderColor = "green";
    } else if (s === false) {
        statusSpan.innerHTML = "Out of sync with server (if this persists, reload the page)"
        statusSpan.style.color = "red";
        textarea.style.backgroundColor = "hsl(0, 60%, 85%)";
        textarea.style.borderColor = "red";
    }
}

// Create the client and pass them their socket
const client = new c_funcs.Client(socket);

var previous = textarea.value;
client.onOutput = function (val, patches, local) {
    // Capture cursor position before change;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    previous = val;
    textarea.value = val;

    // Transform cursor
    if (!local) {
        textarea.selectionStart = pu.transform_cursor(start, patches);
        textarea.selectionEnd = pu.transform_cursor(end, patches);
    }
   
}
textarea.oninput = function() {
    var newText = textarea.value;
    // Compute a simple diff
    var diff = DiffSync.diff_main(previous, newText, textarea.selectionEnd);
    previous = newText;
    // Encode this diff as a patch
    var patches = pu.myers_to_patches(diff)
    client.onedit(patches);
}
// Export globals
window.client = client;
window.socket = socket;