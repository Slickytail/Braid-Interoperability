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
const fuzzbox = document.getElementById('fuzz');
const fuzzhide = document.getElementById('fuzz-params');
const fuzzfreq = document.getElementById('fuzz-freq');
const fuzz_avoid_clobbering = document.getElementById('reserve');

function fuzz() {
    // Make a random edit
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ';
    var text = textarea.value;
    var ins_length = Math.floor(Math.random() * 10);
    var del_length = Math.floor(Math.random() * 10);
    var index = Math.floor(Math.random() * text.length);
    if (clientNum != -1 && fuzz_avoid_clobbering.checked) {
        // We'll edit line N
        // Find the positions of each line number
        var starts = indices(text, "\n")
        if (starts[0] != 0)
            starts.splice(0, 0, 0);
        // Starts is now 0, i_1, i_2, ... with length equal to the number of lines
        while (starts.length < clientNum) {
            text += "\n-------------";
            starts.push(text.indexOf("\n", 1 + starts[starts.length - 1]))
        }
        starts.push(text.length)
        var my_start = starts[clientNum - 1]
        var my_end = starts[clientNum]
        var line_length = my_end - my_start
        index = my_start + Math.floor(Math.random() * line_length);
        del_length = Math.floor(Math.random() * Math.min(10, my_end - index));
        
        ins_length = Math.floor(
            Math.max(
                0,
                Math.min(
                    30,
                    ins_length + (50 - line_length)
                )
            )
        );
    }
    var insert = Array(ins_length)
        .fill(0)
        .map(() => alphabet[Math.floor(Math.random()*alphabet.length)])
        .join('');
    var new_string = text.slice(0, index) + insert + text.slice(index + del_length);
    textarea.value = new_string;
    textarea.oninput();
}

fuzzbox.onclick = function() {
    function l() {
        if (fuzzbox.checked && socket.readyState == WebSocket.OPEN) {
            fuzz();
            var r = parseInt(fuzzfreq.value);
            if (!isNaN(r) && r > 0)
                setTimeout(l, r);
        }
    }
    if (fuzzbox.checked) {
        //fuzzhide.style.display = "block";
        // Trigger fuzzer
        setTimeout(l, 100);
    }
    else {
        //fuzzhide.style.display = "none";
    }
}
fuzzbox.onclick()

statusSpan.innerHTML = "Not Connected";
textarea.style.backgroundColor = "gray";

// Set up the socket
const socket_url = 'ws://' + window.location.host;
const socket = new c_funcs.Socket(socket_url);

// Update DOM with socket status
socket.addEventListener('open', function() {
    statusSpan.innerHTML = "Connected";
    textarea.style.backgroundColor = "white";
})

socket.addEventListener('close', function() {
    statusSpan.innerHTML = "Closed"
    textarea.style.backgroundColor = "gray";
});

socket.addEventListener('error', function() {
    statusSpan.innerHTML = "Error"
    textarea.style.backgroundColor = "red";
});

var clientNum = -1;
socket.addEventListener('message', function(d) {
    var data = JSON.parse(d.data);
    if (data.clientNum) {
        clientNum = data.clientNum;
    }
})
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

function indices(source, find) {
    if (!source) {
      return [];
    }
    // if find is empty string return all indexes.
    if (!find) {
      // or shorter arrow function:
      // return source.split('').map((_,i) => i);
      return source.split('').map(function(_, i) { return i; });
    }
    var result = [];
    for (var i = 0; i < source.length; ++i) {
      // If you want to search case insensitive use 
      // if (source.substring(i, i + find.length).toLowerCase() == find) {
      if (source.substring(i, i + find.length) == find) {
        result.push(i);
      }
    }
    return result;
}