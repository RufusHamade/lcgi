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

// **************************************************************************
// If you want to trace out the execution of this script, uncomment
// the two dump lines below and run firefox from the commandline.
function log(lvl, x)
{
  if (lvl < 1)
    return;

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
// LCGI channel implementation
// Returned by the protocol handler to actually load the page for the browser.
// Has to implement nsIChannel and nsIRequest.
// We also implement nsIStreamListener so we get notified of
// events from aFchan.
// aFchan should be the FileChannel object containing the result.
function LCGIChannel(aUri, aFchan) {
  //this.wrappedJSObject        = this;
  this._done                  = false;
  this._fchan                 = aFchan;

  // nsIRequest fields
  this.name                   = aUri;
  this.loadFlags              = 0;
  this.loadGroup              = null;
  this.status                 = 200;

  // nsIChannel fields.  Some of these will get updated when we get some
  // content back from the file
  this.contentLength          = -1;
  this.contentType            = "text/html";
  this.contentCharset         = "utf-8";
  this.URI                    = aUri;
  this.originalURI            = aUri;
  this.owner                  = null;
  this.notificationCallbacks  = null;
  this.securityInfo           = null;

  log(1, "LCGIChannel: Created");
  log(1, " URI:     " + this.URI.spec);
}

LCGIChannel.prototype = {
  QueryInterface: function(aIID) {
    log(0, "LCGIChannel: QueryInterface "+aIID);

    if (aIID.equals(Ci.nsISupports)) {
      log(0, " Returning nsISupports");
      return this;
    }

    // nsiChannel interfaces
    if (aIID.equals(Ci.nsIRequest)) {
      log(0, " Returning nsIRequest");
      return this;
    }

    if (aIID.equals(Ci.nsIChannel)) {
      log(0, " Returning nsIChannel");
      return this;
    }

    // nsiStreamListener interfaces
    if (aIID.equals(Ci.nsIRequestObserver)) {
      log(0, " Returning nsIRequestObserver");
      return this;
    }

    if (aIID.equals(Ci.nsIStreamListener)) {
      log(0, " Returning nsIStreamListener");
      return this;
    }

    log(0, " Throwing not-supported");
    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  // ***
  // nsIChannel interfaces
  // We don't implement the open function as it seems to be deprecated.
  open: function() {
    log(1, "LCGIChannel: open");
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

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
    this._fchan.asyncOpen(this, this);
  },

  // nsIRequest interfaces.  These are (potentially) called by
  // _xListener and other external ops.
  // We should pass on the function calls to _fchan
  isPending: function() {
    log(1, "LCGIChannel:isPending");
    return !this.done;
  },

  cancel: function(aStatus){
    log(1, "LCGIChannel:cancel");
    this._fchan.cancel(aStatus);
    this.status = aStatus;
    this.done   = true;
  },

  suspend: function(aStatus){
    log(1, "LCGIChannel:suspend");
    this._fchan.suspend(aStatus);
    this.status = aStatus;
  },

  resume: function(aStatus){
    log(1, "LCGIChannel:resume");
    this._fchan.resume(aStatus);
    this.status = aStatus;
  },

  // ***
  // nsIStreamListener interfaces.
  // These are called by the FileInputStream as it reads the file.
  onStartRequest: function(aRequest, aContext) {
    // We basically ignore the onStartRequest.  We need to read some headers
    // before we start our request.
    log(1, "LCGIChannel: onStartRequest from fchan");
  },

  onDataAvailable: function(aRequest, aContext, aIStream, aOffset, aCount) {
    log(1, "LCGIChannel: onDataAvailable from fchan");
    if (!this._gotHeaders){
      log(1, " Parsing headers");
      // Most of the work happens here.  If we haven't read the headers,
      // read them in now and issue our onStartRequest.
      var sis = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
      sis.init(aIStream);
      var data  = sis.read(aCount);
      var start = 0;
      do {
        var end = data.indexOf('\n', start);
        if (end < 0){
          log(1, " No newline found");
          break;
        }
        var line = data.substring(start, end);
        log(1, " Line "+line);
        var re =/Content-type:\s*(\S+)/i;
        var match = re.exec(line);
        if (match){
          log(1, " Got content type "+match[1]);
          this.contentType = match[1];
        }
        start = end+1;
      } while (line.length > 2);

      log(1, " Pass rest of data to _xListener");
      data = data.substring(start);
      var pipe = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);
      pipe.init(true,true,0,0,null);
      pipe.outputStream.write(data, data.length);
      pipe.outputStream.close();

      this._gotHeaders = true;
      this._xListener.onStartRequest(this,this._xContext);
      this._xListener.onDataAvailable(this, this._xContext, pipe.inputStream, 0, data.length);
    }
    else {
      log(1, " Passing remainder to listener");
      this._xListener.onDataAvailable(this, this._xContext, aIStream, aOffset, aCount);
    }
  },

  onStopRequest: function(aRequest, aContext, aStatusCode) {
    log(1, "LCGIChannel: onStopRequest from fchan");
    this.status = aStatusCode;
    this._xListener.onStopRequest(this,this._xContext, this.status);
  }
};

// **************************************************************************
// LCGI protocol handler implementation
function LCGIHandler() {
  // this.wrappedJSObject = this;
}

LCGIHandler.prototype = {
  QueryInterface: function(aIID) {
    if (!aIID.equals(Ci.nsIProtocolHandler) &&
        !aIID.equals(Ci.nsISupports)){
      throw Cr.NS_ERROR_NO_INTERFACE;
    }
    return this;
  },

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


    var ds      = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
    var tmpdir  = ds.get("TmpD", Ci.nsIFile);
    var envs    = tmpdir.clone();
    var rslt    = tmpdir.clone();
    envs.append("lcgi-envs");
    rslt.append("lcgi-rslt");

    log(1, " env file:    "+envs.path);
    log(1, " rslt file:   "+rslt.path);

    var cgiwrap = __LOCATION__.parent.parent.clone();
    cgiwrap.append("cgiwrap.sh");

    log(1, " CGI wrapper: "+cgiwrap.path);

    log(1, " Write envs file");
    var ostream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    ostream.init(envs, 0x02 | 0x08 | 0x20, 0600, 0);// Hex constants are PR_WRONLY, PR_CREATE_FILE, PR_TRUNCATE

    var converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
    converter.init(ostream, "UTF-8", 0, 0);

    converter.writeString("export SERVER_SOFTWARE=mozilla/firefox/lcgi\n");
    converter.writeString("export SERVER_NAME=localhost\n");
    converter.writeString("export GATEWAY_INTERFACE=LCGI/0.1\n");
    // Not SERVER_PROTOCOL
    // Not SERVER_PORT
    converter.writeString("export REQUEST_METHOD=GET\n");// Should specify whether its GET or POST
    converter.writeString("export PATH_INFO=\""+path+"\"\n");
    converter.writeString("export PATH_TRANSLATED=\""+path+"\"\n");
    converter.writeString("export SCRIPT_NAME=\""+path+"\"\n");
    converter.writeString("export QUERY_STRING=\""+args+"\"\n");// Needs to be updated with query details
    converter.writeString("export REMOTE_HOST=localhost\n");
    converter.writeString("export REMOTE_ADDR=127.0.0.1\n");
    // Not AUTH_TYPE
    // Not REMOTE_USER
    // Not REMOTE_IDENT
    // Not CONTENT_TYPE until POST supported
    // Not CONTENT_LENGTH until POST supported
    // And any other http request headers.
    converter.close();

    log(1, " Invoking script " + fileuri.path);
    var bash    = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    bash.initWithPath("/bin/sh");
    var process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(bash);

    var args = [cgiwrap.path, envs.path, fileuri.path, rslt.path];
    process.run(true, args, args.length);
    log(1, " Process returned "+process.exitValue);

    if (process.exitValue != 0) {
      throw Cr.NS_ERROR_FILE_EXECUTION_FAILED;
    }

    var rslturi = ioServ.newFileURI(rslt);
    log(1, " Returning contents of file " + rslturi.spec);
    var chan    = ioServ.newChannelFromURI(rslturi);

    return new LCGIChannel(aUri, chan);
  }
};

// **************************************************************************
// Rest of this is boilerplate "copied" from
// http://hyperstruct.net/2006/8/10/your-first-javascript-xpcom-component-in-10-minutes
// and
// http://kb.mozillazine.org/Implementing_XPCOM_components_in_JavaScript

// LCGI handler factory.   Create a new LCGI handler
var LCGIHandlerFactory = {
  createInstance: function(aOuter, aIID) {
    log(1, "Creating lcgi handler");
    if (aOuter != null){
      throw Cr.NS_ERROR_NO_AGGREGATION;
    }

    return new LCGIHandler().QueryInterface(aIID);
  }
};

// LCGI module.  Register the interface and factory.
var LCGIHandlerModule = {
  _firstTime: true,

  registerSelf: function(aCompMgr, aFileSpec, aLocation, aType) {
    if (this._firstTime) {
      this._firstTime = false;
      throw Cr.NS_ERROR_FACTORY_REGISTER_AGAIN;
    }

    aCompMgr = aCompMgr.QueryInterface(Ci.nsIComponentRegistrar);
    aCompMgr.registerFactoryLocation(LCGI_PROTOCOL_CLASSID,
                                     LCGI_PROTOCOL_NAME,
                                     LCGI_PROTOCOL_CONTRACTID,
                                     aFileSpec,
                                     aLocation,
                                     aType);
  },

  unregisterSelf: function(aCompMgr, aLocation, aType) {
    aCompMgr = aCompMgr.QueryInterface(Ci.nsIComponentRegistrar);
    aCompMgr.unregisterFactoryLocation(LCGI_PROTOCOL_CLASSID, aLocation);
  },

  getClassObject: function(aCompMgr, aCID, aIID) {
    if (!aIID.equals(Ci.nsIFactory)){
      throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    }

    if (aCID.equals(LCGI_PROTOCOL_CLASSID)){
      return LCGIHandlerFactory;
    }

    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  canUnload: function(aCompMgr) {
    return true;
  }
};

// initialization
function NSGetModule(aCompMgr, aFileSpec) {
  return LCGIHandlerModule;
}
