// This object implements the details of the "Open local CGI" menu item
var lcgi = {
  onLoad: function() {
    // initialization code
    this.initialized = true;
    this.strings = document.getElementById("lcgi-strings");
  },

  onMenuItemCommand: function(e) {
    const nsIFilePicker = Components.interfaces.nsIFilePicker;
    var fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    fp.init(window, this.strings.getString('description'), nsIFilePicker.modeOpen);
    fp.appendFilters(nsIFilePicker.filterAll | nsIFilePicker.filterApps);

    var dd = Components.classes["@mozilla.org/file/directory_service;1"].getService(Components.interfaces.nsIProperties).get("Home", Components.interfaces.nsIFile);
    fp.displayDirectory = dd;

    var rv = fp.show();
    if (rv == nsIFilePicker.returnOK) {
      var uri = 'lcgi:' + fp.file.path;
      loadURI(uri, null, null, true);
    }
  }
};

window.addEventListener("load", function(e) { lcgi.onLoad(e); }, false);

