/* ***** BEGIN LICENSE BLOCK ***** Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The Original Code is Copyright (c) 2009
 * Author: Rufus Hamade <rufus@myfanwy.org.uk>.
 *
 * The contents of this file are subject to the Mozilla Public License
 * Version 1.1 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License
 * at http://www.mozilla.org/MPL/
 *
 * Alternatively, the contents of this file may be used under the
 * terms of either the GNU General Public License Version 2 or later
 * (the "GPL"), or the GNU Lesser General Public License Version 2.1
 * or later (the "LGPL"), in which case the provisions of the GPL or
 * the LGPL are applicable instead of those above.
 *
 * If you wish to allow use of your version of this file only under
 * the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate
 * your decision by deleting the provisions above and replace them
 * with the notice and other provisions required by the GPL or the
 * LGPL. If you do not delete the provisions above, a recipient may
 * use your version of this file under the terms of any one of the
 * MPL, the GPL or the LGPL.
 *
 * Software distributed under the License is distributed on an "AS IS"
 * basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See
 * the License for the specific language governing rights and
 * limitations under the License.
 *
 * ***** END LICENSE BLOCK ***** */

// **************************************************************************
// A lot of this code was constructed using the following resources:
// MDC
// http://archangel.mozdev.org/new-protocol.html
// http://groups.google.com/group/mozilla.dev.tech.xpcom/browse_thread/thread/fd8343423982c154?pli=1
// Thanks to all those people who've navigated these choppy waters before me;->
// **************************************************************************

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/subprocess.jsm");

// **************************************************************************
// If you want to trace out the execution of this script, uncomment
// the dump lines below and run firefox from the commandline.
function log(lvl, x)
{
  if (lvl <= 0)
    return;

  dump('LCGI: ');
  dump(x);
  dump('\n');
}

// **************************************************************************
// Constants defining our interface as seen by the rest of firefox

const LCGI_PROTOCOL_SCHEME     = "lcgi";
const LCGI_PROTOCOL_NAME       = "'lcgi:' URI scheme";
const LCGI_PROTOCOL_CONTRACTID = "@mozilla.org/network/protocol;1?name="+LCGI_PROTOCOL_SCHEME;
const LCGI_PROTOCOL_CLASSID    = Components.ID("{c2f4e52d-a93d-4d53-8d56-79a0def5885e}");

// **************************************************************************
// Error channel implementation.  Return an error message to the user.
//
function LCGIErrorChannel(aUri, aRetcode) {
  log(1, "Created LCGIErrorChannel");
  //this.wrappedJSObject        = this;
  this._done                  = false;
  this._retcode               = aRetcode;

  // nsIRequest fields
  this.name                   = aUri;
  this.loadFlags              = 0;
  this.loadGroup              = null;
  this.status                 = 501;

  // nsIChannel fields
  this.contentLength          = -1;
  this.contentType            = "text/html";
  this.contentCharset         = "utf-8";
  this.URI                    = aUri;
  this.originalURI            = aUri;
  this.owner                  = null;
  this.notificationCallbacks  = null;
  this.securityInfo           = null;

  log(1, " URI:     " + this.URI.spec);
}

LCGIErrorChannel.prototype = {
    QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports, Ci.nsIRequest, Ci.nsIChannel]),

  // nsIReqiest interfaces
  isPending: function() {
    log(1, "LCGIErrorChannel:isPending");
    return !this.done;
  },

  // For the next few methods, as we do everything in a single op, we can
  // (other than saving off the status value) safely ignore these ops.
  cancel: function(aStatus){
    log(1, "LCGIErrorChannel:cancel");
    this.status = aStatus;
    this.done   = true;
  },

  suspend: function(aStatus){
    log(1, "LCGIErrorChannel:suspend");
    this.status = aStatus;
  },

  resume: function(aStatus){
    log(1, "LCGIErrorChannel:resume");
    this.status = aStatus;
  },

  // Channel interfaces
  // The browser uses this to start a fetch.
  //
  // Normally we'd start the machinery to fetch the data, and as it
  // became available call the InputStreamListener methods as appropriate.
  // But all the data is available immediately, so we can call the
  // stream listener methods inline.
  asyncOpen: function(aListener, aContext) {
    log(1, "LCGIErrorChannel:asyncOpen");
    this.listener = aListener;
    this.context  = aContext;

    log(1, " Invoking onStartRequest");
    aListener.onStartRequest(this, aContext);

    // Create a pipe and fill it with data to display.
    log(1, " Preparing pipe");
    var pipe = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);
    pipe.init(true,true,0,0,null);
    var result = '<html><head><title>LCGI Script Error.</title></head>'           +
                 '<body><h1>LCGI Script Error.</h1>'                                +
                 '<h2>CGI script exited with return code '+this._retcode+ ' and no content.</h2>' +
                 '</body></html>';
    pipe.outputStream.write(result,result.length);
    pipe.outputStream.close();

    // Pass the InputStream part of the pipe to the listener.
    log(1, " Invoking onDataAvailable");
    aListener.onDataAvailable(this, aContext, pipe.inputStream, 0, result.length);

    log(1, " Invoking onStopRequest");
    this.done = true;
    aListener.onStopRequest(this, aContext, this.status);
  }
};


// **************************************************************************
// LCGI channel implementation
// Returned by the protocol handler to actually load the page for the browser.
// Has to implement nsIChannel and nsIRequest.
function LCGIChannel(aUri, stream) {
  log(1, "LCGIChannel: Created");
  this._pipe = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);
  this._pipe.init(true,true,0,0,null);
  this._done                  = false;
  this._gotHeaders            = false;
  this._savedData             = "";

  // nsIRequest fields
  this.name                   = aUri;
  this.loadFlags              = 0;
  this.loadGroup              = null;
  this.status                 = 200;

  // nsIChannel fields.  Some of these will get updated when we get some
  // content back from the file
  this.contentLength          = -1;
  this.contentType            = "text/plain";
  this.contentCharset         = "utf-8";
  this.URI                    = aUri;
  this.originalURI            = aUri;
  this.owner                  = null;
  this.notificationCallbacks  = null;
  this.securityInfo           = null;

  log(1, " URI:     " + this.URI.spec);
}

LCGIChannel.prototype = {
    QueryInterface : XPCOMUtils.generateQI([Ci.nsISupports, Ci.nsIRequest, Ci.nsIChannel]),

  // ***
  // nsIChannel interfaces

  // The browser uses this to start a fetch.
  //
  // Start the machinery to fetch the data, and as it becomes
  // available, call the InputStreamListener methods as appropriate.
  asyncOpen: function(aListener, aContext) {
    log(1, "LCGIChannel: asyncOpen");
    // Start reading the file.  We use ourselves as the listener.
    this._xListener  = aListener;
    this._xContext   = aContext;
    this._gotHeaders = false;    
  },

  // ***
  // nsIRequest interfaces.  These are (potentially) called by
  // _xListener and other external ops.
  isPending: function() {
    log(1, "LCGIChannel:isPending");
    return !this.done;
  },

  cancel: function(aStatus){
    log(1, "LCGIChannel:cancel");
    this.status = aStatus;
    this.done   = true;
  },

  suspend: function(aStatus){
    log(1, "LCGIChannel:suspend");
    this.status = aStatus;
  },

  resume: function(aStatus){
    log(1, "LCGIChannel:resume");
    this.status = aStatus;
  },

  // ***
  // This method is invoked by the stdout process callback
  // We parse any headers in the request and pass on the data to _xListener.
  consumeData: function(process, data) {
    log(1, "LCGIChannel: consumeData");

    if (this._savedData.length > 0) {
      log(1, " Reusing saved data");
      data = this._savedData + data;
      this._savedData = "";
    }

    if (!this._gotHeaders){
      log(1, " Parsing headers");
      // Most of the work happens here.  If we haven't read the headers,
      // read them in now and issue our onStartRequest.
      var start = 0;
      do {
        var end = data.indexOf('\n', start);
        if (end < 0){
          log(1, " No newline found");
          this._savedData = data.substring(start);
          return;
        }

        var line = data.substring(start, end);
        log(1, " Line "+line);
        var ctre =/Content-type:\s*(\S+)/i;
        var match = ctre.exec(line);
        if (match){
          log(1, "  Got content type "+match[1]);
          this.contentType = match[1];
        }

        var stre =/Status:\s*(\S+)/i;
        match = stre.exec(line);
        if (match){
          log(1, "  Got status "+match[1]);
          this.status = parseInt(match[1]);
        }

        start = end+1;
      } while (start < data.length && line.length > 2);

      if (start >= data.length) {
        // We may have found headers, but we don't have any content.
        // Show the headers to the client instead.
        start = 0;
      }

      data = data.substring(start);

      this._xListener.onStartRequest(this, this._xContext);
      this._gotHeaders = true;
    }

    log(1, " Pass data to _xListener");
    this._pipe.outputStream.write(data, data.length);
    this._xListener.onDataAvailable(this, this._xContext, this._pipe.inputStream, 0, data.length);
  },
  
  // ***
  // This method is invoked by the onFinished process callback
  // Pass on any data we've been storing in the _savedData to _xListener, then invoke onStopRequest.
  consumeClose: function(process) {
    log(1, "LCGIChannel: consumeClose");
    if (this._savedData.length > 0) {
      this._xListener.onStartRequest(this, this._xContext);
      this._pipe.outputStream.write(this._savedData, this._savedData.length);
      this._xListener.onDataAvailable(this, this._xContext, this._pipe.inputStream, 0, this._savedData.length);
    }
    this._xListener.onStopRequest(this, this._xContext, this.status);
  }
};

// **************************************************************************
// LCGI protocol handler implementation
function LCGIHandler() {
  // this.wrappedJSObject = this;
}

LCGIHandler.prototype = {
    classDescription: LCGI_PROTOCOL_NAME,
    classID:          LCGI_PROTOCOL_CLASSID,
    contractID:       LCGI_PROTOCOL_CONTRACTID,

    QueryInterface : XPCOMUtils.generateQI([Ci.nsIProtocolHandler, Ci.nsISupports]),

    scheme: LCGI_PROTOCOL_SCHEME,
    defaultPort: -1,
    protocolFlags: Ci.nsIProtocolHandler.URI_IS_LOCAL_FILE,

    allowPort: function(aPort, aScheme) {
        return false;
    },

  newURI: function(aSpec, aCharset, aBase) {
    // Should probably use nsStandardURL to do this to be consistent.
    // But following code seems to work OK.
    log(1, "LCGIHandler: newURI from "+aSpec);

    var uri  = Cc["@mozilla.org/network/simple-uri;1"].createInstance(Ci.nsIURI);
    if (!aBase) {
      log(1, " No base URI");
      uri.spec = aSpec;
      return uri;
    }

    log(1, " Base URI is "+aBase.spec);

    if (aSpec.indexOf(LCGI_PROTOCOL_SCHEME) == 0) {
      log(1, " Got absolute URI, so ignore base");
      uri.spec = aSpec;
      return uri;
    }

    uri.scheme = LCGI_PROTOCOL_SCHEME;

    if (aSpec.indexOf('/') == 0) {
      log(1, " Got relative URI, but absolute path");
      uri.path = aSpec;
      return uri;
    }

    var idx  = aBase.path.lastIndexOf('/');
    var path = aBase.path.substring(0,idx+1);

    log(1, " Prepending aBase path " +path);
    aSpec = path + aSpec;

    uri.path   = aSpec;
    log(1, " Set uri to "+uri.spec);
    return uri;
  },

  newChannel: function(aUri) {
    log(1, "LCGIHandler: newChannel " + aUri.spec);
    var path   = aUri.path;
    var argidx = path.indexOf('?');
    var args   = "";
    if (argidx > 0) {
      args = path.substring(argidx+1);
      path = path.substring(0,argidx);
      log(1, "Split URL into"+path+" and "+args);
    }
    var fileURIStr = "file://" + path;
    log(1, " Fetching file " + fileURIStr);

    var ioServ  = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    var fileuri = ioServ.newURI(fileURIStr, null, null);
    var file    = fileuri.QueryInterface(Ci.nsIFileURL).file;

    if (!file.exists()) {
      log(1, " No such file " + fileuri.spec);
      throw Cr.NS_ERROR_FILE_NOT_FOUND;
    }

    if (file.isDirectory() || !file.isExecutable()) {
      log(1, " Returning contents of file " + fileuri.spec);
      var chan = ioServ.newChannelFromURI(fileuri);
      return chan;
    }

    var envs = [ "SERVER_SOFTWARE=mozilla/firefox/lcgi",
                 "SERVER_NAME=localhost",
                 "GATEWAY_INTERFACE=LCGI/0.1",
                 // Not SERVER_PROTOCOL
                 // Not SERVER_PORT
                 "REQUEST_METHOD=GET", // Should specify whether its GET or POST
                 "PATH_INFO="+path,
                 "PATH_TRANSLATED="+path, 
                 "SCRIPT_NAME="+path, 
                 "SCRIPT_FILENAME="+path, // Required for Ubuntu's php-cgi
                 "QUERY_STRING="+args, // Needs to be updated with query details
                 "REMOTE_HOST=localhost",
                 "REMOTE_ADDR=127.0.0.1",
                 "REDIRECT_STATUS=200", // PHP CGI workaround.
                 // Not AUTH_TYPE
                 // Not REMOTE_USER
                 // Not REMOTE_IDENT
                 // Not CONTENT_TYPE until POST supported
                 // Not CONTENT_LENGTH until POST supported
                 // And any other http request headers.
    ];

    log(1, " Invoking script " + fileuri.path);
    var channel = new LCGIChannel(aUri);

    var process = subprocess.call({
        command: file,
        arguments: [fileuri.path],
        environment: envs,
        stdout: subprocess.ReadablePipe(function(data) {
            log(1, "Subprocess: Process wrote some data "+ data.length);
            channel.consumeData(process, data);
        }),
        mergeStderr: true,
        onFinished: subprocess.Terminate(function() {
            log(1, "Subprocess: Process returned "+process.exitCode);
            channel.consumeClose(process);
        }),
    });

    log(1, " Process executed");

    return channel;
  }
};

// initialization
var NSGetFactory = XPCOMUtils.generateNSGetFactory([LCGIHandler]);
