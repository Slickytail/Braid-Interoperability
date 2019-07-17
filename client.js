// Include client libraries
const Sync9C = require('./lib/client/sync9_client')
const ShareDBC = require('./lib/client/sharedb_client')
const AutomergeC = require('./lib/client/automerge_client')
const DiffSync = require('./lib/diffsync')
// Include util libraries
const pu = require('./lib/patch')
const TransparentSocket = require('./lib/client/socket.js');
// Figure out which algorithm we're supposed to use
const urlParams = new URLSearchParams(window.location.search);

var c_funcs;
var c_name;
if (urlParams.has("sharedb")) {
    c_funcs = ShareDBC;
    c_name = "ShareDB"
}
else if (urlParams.has("automerge")) {
    c_funcs = AutomergeC;
    c_name = "Automerge"
}
else {
    c_funcs = Sync9C;
    c_name = "Sync9"
}
document.getElementById('alg').innerHTML = c_name

// Set up DOM elements
const textarea = document.querySelector('textarea');
const statusSpan = document.getElementById('status-span');

statusSpan.innerHTML = "Not Connected";
textarea.style.backgroundColor = "gray";

// Set up the socket
const socket_url = 'ws://invisible.college:1200/interoperability'
const socket = new c_funcs.Socket(socket_url);

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
        statusSpan.innerHTML = "Out of sync with server"
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