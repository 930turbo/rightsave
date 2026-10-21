// Test-only replacement of Firefox's native picker service in an isolated profile.
// Exercises the browser's real Save As path without opening an unattended OS dialog.
const pickerDirectory = arguments[0];
window.__rightSavePickerCalls = [];
window.__rightSaveCancelNext = false;
window.__rightSaveHoldNext = false;
window.__rightSavePendingPicker = null;
const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
const pickerClass = Components.ID("{8eacb2ac-28d4-4cff-9414-81df13535e89}");
const factory = {
  QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
  createInstance(iid) {
    const picker = {
      QueryInterface: ChromeUtils.generateQI(["nsIFilePicker"]),
      init(parent, title, mode) { this.title = title; this.mode = mode; },
      appendFilter() {}, appendFilters() {},
      defaultString: "", defaultExtension: "", filterIndex: 0,
      get fileURL() { return Services.io.newFileURI(this.file); },
      open(callback) {
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(pickerDirectory);
        const proposed = this.defaultString || "saved-file";
        let name = proposed;
        const dot = proposed.lastIndexOf(".");
        const stem = dot < 0 ? proposed : proposed.slice(0, dot);
        const extension = dot < 0 ? "" : proposed.slice(dot);
        let index = 0;
        file.append(name);
        while (file.exists()) { file.leafName = `${stem}(${++index})${extension}`; }
        this.file = file;
        const cancel = window.__rightSaveCancelNext;
        window.__rightSaveCancelNext = false;
        window.__rightSavePickerCalls.push({mode: this.mode, name: proposed, path: file.path, cancel, time: Date.now()});
        const finish = () => callback.done(cancel ? Ci.nsIFilePicker.returnCancel : Ci.nsIFilePicker.returnOK);
        if (window.__rightSaveHoldNext) {
          window.__rightSaveHoldNext = false;
          window.__rightSavePendingPicker = finish;
        } else setTimeout(finish, 0);
      }
    };
    return picker.QueryInterface(iid);
  }
};
registrar.registerFactory(pickerClass, "RightSave test picker", "@mozilla.org/filepicker;1", factory);
window.__rightSavePickerFactory = factory;
return true;
