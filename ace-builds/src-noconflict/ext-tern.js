///(10.4.2014) * [TODO:translateToSession] - add this tag to methods that need translating to use session instead of editor
/*jshint maxerr:10000 */

/**
 * Ace Tern server configuration (uses worker in separate file)
 *
 * TODO:
 * - make enable/disable tern server via ace config and expose the server as public exports
 * - auto init the server and disable it when its not needed
 */


ace.define('ace/ext/tern', ['require', 'exports', 'module', 'ace/snippets', 'ace/autocomplete', 'ace/config', 'ace/editor'],

function(require, exports, module) {

    //#region LoadCompletors_fromLangTools

    /* Copied from ext-language_tools.js
     * needed to allow completors for all languages
     * adds extra logic to disable keyword and basic completors for javscript mode and enable tern instead
     */
    var snippetManager = require("../snippets").snippetManager;
    var snippetCompleter = {
        getCompletions: function(editor, session, pos, prefix, callback) {
            var snippetMap = snippetManager.snippetMap;
            var completions = [];
            snippetManager.getActiveScopes(editor).forEach(function(scope) {
                var snippets = snippetMap[scope] || [];
                for (var i = snippets.length; i--;) {
                    var s = snippets[i];
                    var caption = s.name || s.tabTrigger;
                    if (!caption) continue;
                    completions.push({
                        caption: caption,
                        snippet: s.content,
                        meta: s.tabTrigger && !s.name ? s.tabTrigger + "\u21E5 " : "snippet"
                    });
                }
            }, this);
            callback(null, completions);
        }
    };
    var textCompleter = require("../autocomplete/text_completer");
    var keyWordCompleter = {
        getCompletions: function(editor, session, pos, prefix, callback) {
            var state = editor.session.getState(pos.row);
            var completions = session.$mode.getCompletions(state, session, pos, prefix);
            callback(null, completions);
        }
    };
    var completers = [snippetCompleter, textCompleter, keyWordCompleter];
    exports.addCompleter = function(completer) {
        completers.push(completer);
    };
    var expandSnippet = {
        name: "expandSnippet",
        exec: function(editor) {
            var success = snippetManager.expandWithTab(editor);
            if (!success) editor.execCommand("indent");
        },
        bindKey: "tab"
    };
    var loadSnippetsForMode = function(mode) {
        var id = mode.$id;
        if (!snippetManager.files) snippetManager.files = {};
        loadSnippetFile(id);
        if (mode.modes) mode.modes.forEach(loadSnippetsForMode);
    };
    var loadSnippetFile = function(id) {
        if (!id || snippetManager.files[id]) return;
        var snippetFilePath = id.replace("mode", "snippets");
        snippetManager.files[id] = {};
        config.loadModule(snippetFilePath, function(m) {
            if (m) {
                snippetManager.files[id] = m;
                m.snippets = snippetManager.parseSnippetFile(m.snippetText);
                snippetManager.register(m.snippets, m.scope);
                if (m.includeScopes) {
                    snippetManager.snippetMap[m.scope].includeScopes = m.includeScopes;
                    m.includeScopes.forEach(function(x) {
                        loadSnippetFile("ace/mode/" + x);
                    });
                }
            }
        });
    };
    //#endregion


    //#region AutoComplete

    /* Override the StartAutoComplete command (from ext-language_tools)   */
    var Autocomplete = require("../autocomplete").Autocomplete;
    Autocomplete.startCommand = {
        name: "startAutocomplete",
        exec: function(editor) {
            if (!editor.completer) {
                editor.completer = new Autocomplete();
            }
            //determine which completers should be enabled
            editor.completers = [];
            if (editor.$enableSnippets) { //snippets are allowed with or without tern
                editor.completers.push(snippetCompleter);
            }

            if (editor.ternServer && editor.$enableTern) {
                //enable tern based on mode
                if (editor.ternServer.enabledAtCurrentLocation(editor)) {
                    editor.completers.push(editor.ternServer);
                    editor.ternServer.aceTextCompletor = textCompleter; //9.30.2014- give tern the text completor
                }
                else {
                    if (editor.$enableBasicAutocompletion) {
                        editor.completers.push(textCompleter, keyWordCompleter);
                    }
                }
            }
            else { //tern not enabled
                if (editor.$enableBasicAutocompletion) {
                    editor.completers.push(textCompleter, keyWordCompleter);
                }
            }
            editor.completer.showPopup(editor);
            editor.completer.cancelContextMenu();
        },
        bindKey: "Ctrl-Space|Ctrl-Shift-Space|Alt-Space"
    };
    var onChangeMode = function(e, editor) {
        loadSnippetsForMode(editor.session.$mode);
        // log(editor, editor.session.$mode);
    };
    //#endregion


    //#region Tern
    var TernServer = require("../tern").TernServer;
    var aceTs = new TernServer({
        defs: ['jquery', 'browser', 'ecma5'],
        plugins: {
            doc_comment: true,
            requirejs: {
                "baseURL": "./",
                "paths": {}
            },
        },
        workerScript: ace.config.moduleUrl('worker/tern'),
        useWorker: true,
        switchToDoc: function(name, start) {
            console.log('COMEBACK. add functionality to siwtch to doc from tern. name=' + name + '; start=' + start);
        }
    });
    //hack: need a better solution to get the editor variable inside of the editor.getSession().selection.onchangeCursor event as the passed variable is of the selection, not the editor. This variable is being set in the enableTern set Option
    var editor_for_OnCusorChange = null;

    var debounce_ternShowType;
    //show arguments hints when cursor is moved
    var onCursorChange_Tern = function(e, editor_getSession_selection) {
        //debounce to auto show type
        clearTimeout(debounce_ternShowType);
        debounce_ternShowType = setTimeout(function() {
            editor_for_OnCusorChange.ternServer.showType(editor_for_OnCusorChange, null, true); //show type
        }, 300);

        editor_for_OnCusorChange.ternServer.updateArgHints(editor_for_OnCusorChange);
    };

    //automatically start auto complete when period is typed
    var onAfterExec_Tern = function(e, commandManager) {
        if (e.command.name === "insertstring" && e.args === ".") {
            if (e.editor.ternServer && e.editor.ternServer.enabledAtCurrentLocation(e.editor)) {
                var pos = editor.getSelectionRange().end;
                var tok = editor.session.getTokenAt(pos.row, pos.column);
                if (tok) {
                    if (tok.type !== 'string' && tok.type.toString().indexOf('comment') === -1) {
                        e.editor.execCommand("startAutocomplete");
                    }
                }
            }
        }
    };

    //minimum string length for tern local string completions. set to -1 to disable this
    var ternLocalStringMinLength = 3;

    console.log('TODO- add method for turning off tern server, should also be automatic on mode change. Make sure to remove the cursorchange event bindings that tern has when its off/disabled');
    completers.push(aceTs); //add
    exports.server = aceTs;

    var config = require("../config");
    var Editor = require("../editor").Editor;
    config.defineOptions(Editor.prototype, "editor", {
        enableTern: {
            set: function(val) {
                if (val) {
                    //set default ternLocalStringMinLength
                    if (this.getOption('ternLocalStringMinLength') === undefined) {
                        this.setOption('ternLocalStringMinLength', ternLocalStringMinLength);
                    }
                    this.completers = completers;
                    this.ternServer = aceTs;
                    this.commands.addCommand(Autocomplete.startCommand);
                    editor_for_OnCusorChange = this; //hack
                    // console.log('binding on cursor change');
                    this.getSession().selection.on('changeCursor', onCursorChange_Tern);
                    this.commands.on('afterExec', onAfterExec_Tern);
                    aceTs.bindAceKeys(this);
                }
                else {
                    this.ternServer = undefined;
                    // console.log('disabling on cursor change');
                    this.getSession().selection.off('changeCursor', onCursorChange_Tern);
                    this.commands.off('afterExec', onAfterExec_Tern);
                    if (!this.enableBasicAutocompletion) {
                        this.commands.removeCommand(Autocomplete.startCommand);
                    }
                }
            },
            value: false
        },
        ternLocalStringMinLength: {
            set: function(val) {
                ternLocalStringMinLength = parseInt(val, 10);
            },
            value: false
        },
        enableBasicAutocompletion: {
            set: function(val) {
                if (val) {
                    this.completers = completers;
                    this.commands.addCommand(Autocomplete.startCommand);
                }
                else {
                    if (!this.$enableTern) {
                        this.commands.removeCommand(Autocomplete.startCommand);
                    }
                }
            },
            value: false
        },
        enableSnippets: {
            set: function(val) {
                if (val) {
                    this.commands.addCommand(expandSnippet);
                    this.on("changeMode", onChangeMode);
                    onChangeMode(null, this);
                }
                else {
                    this.commands.removeCommand(expandSnippet);
                    this.off("changeMode", onChangeMode);
                }
            },
            value: false
        }
        //ADD OPTIONS FOR TERN HERE... maybe-- or just let the exports do it
    });
    //#endregion
});

/**
 *  tern server plugin for ace
 */
ace.define('ace/tern', ['require', 'exports', 'module', 'ace/lib/dom'], function(require, exports, module) {

    //#region TernServerPublic

    /**
     * Tern Server Constructor {@link http://ternjs.net/doc/manual.html}
     * @param {object} options - Options for server
     * @param {string[]} [options.defs] - The definition objects to load into the server’s environment.
     * @param {object} [options.plugins] - Specifies the set of plugins that the server should load. The property names of the object name the plugins, and their values hold options that will be passed to them.
     * @param {function} [options.getFile] - Provides a way for the server to try and fetch the content of files. Depending on the async option, this is either a function that takes a filename and returns a string (when not async), or a function that takes a filename and a callback, and calls the callback with an optional error as the first argument, and the content string (if no error) as the second.
     * @param {bool} [options.async=false] - Indicates whether getFile is asynchronous
     * @param {int} [options.fetchTimeout=1000] - Indicates the maximum amount of milliseconds to wait for an asynchronous getFile before giving up on it
     */
    var TernServer = function(options) {
        var self = this;
        this.options = options || {};
        var plugins = this.options.plugins || (this.options.plugins = {});
        if (!plugins.doc_comment) {
            plugins.doc_comment = true;
        }
        if (!plugins.requirejs) {
            plugins.requirejs = {
                "paths": {}
            };
        }
        if (this.options.useWorker) {
            //console.log('using workiner');
            this.server = new WorkerServer(this);
        }
        else {
            //  logO(plugins, 'plugins in new tern server');
            this.server = new tern.Server({
                getFile: function(name, c) {
                    return getFile(self, name, c);
                },
                async: true,
                defs: this.options.defs || [],
                plugins: plugins
            });
        }
        this.docs = Object.create(null);
        /**
         * Fired from editor.onChange
         * @param {object} change - change event from editor
         * @param {editSession} session
         */
        this.trackChange = function(change, session) {
            trackChange(self, session, change);
        };
        this.cachedArgHints = null;
        this.activeArgHints = null;
        this.jumpStack = [];
        /**
         * 9.30.2014- set when mode changes and tern is enabled, this is the built in ace text completor;
         * Giving tern control of the built in text completor allows tern to fall back to it when no tern completions are found, and it allows tern to include text completions in results when user fires auto complete twice within a second;
         */
        this.aceTextCompletor = null;
        /**
         * 9.30.2014- set every time auto complete is fired;
         * used to include all completions if fired twice in one second
         */
        this.lastAutoCompleteFireTime = null;
    };

    //#region helpers

    /**
     * returns line,ch posistion
     */
    var Pos = function(line, ch) {
        return {
            "line": line,
            "ch": ch
        };
    };
    var cls = "Ace-Tern-";
    var bigDoc = 250;
    var aceCommands = {
        ternJumpToDef: {
            name: "ternJumpToDef",
            exec: function(editor) {
                editor.ternServer.jumpToDef(editor);
            },
            bindKey: "Alt-."
        },
        ternJumpBack: {
            name: "ternJumpBack",
            exec: function(editor) {
                editor.ternServer.jumpBack(editor);
            },
            bindKey: "Alt-,"
        },
        ternShowType: {
            name: "ternShowType",
            exec: function(editor) {
                editor.ternServer.showType(editor);
            },
            bindKey: "Ctrl-I"
        },
        ternFindRefs: {
            name: "ternFindRefs",
            exec: function(editor) {
                editor.ternServer.findRefs(editor);
            },
            bindKey: "Ctrl-E"
        },
        ternRename: {
            name: "ternRename",
            exec: function(editor) {
                editor.ternServer.rename(editor);
            },
            bindKey: "Ctrl-Shift-E"
        },
        ternRefresh: {
            name: "ternRefresh",
            exec: function(editor) {
                editor.ternServer.refreshDoc(editor);
            },
            bindKey: "Alt-R"
        }
    };

    /**
     * Creates new Ace Edit Session
     * @param {string} documentText - text of document to create edit session for
     */
    function newAceEditSession(documentText) {
        var EditSession = ace.require("ace/edit_session").EditSession;
        return new EditSession(documentText, "ace/mode/javascript");
    }
    //#endregion

    TernServer.prototype = {
        bindAceKeys: function(editor) {
            for (var p in aceCommands) {
                var obj = aceCommands[p];
                editor.commands.addCommand(obj);
            }
        },
        /**
         * Add a file to tern server (not sure what this is supposed to return)
         * @param {string} name - name of file (should be full path)
         * @param {string | editSession} session - contents of the file | ace edit session (edit session preferred... string is a hack that should be removed in future)
         */
        addDoc: function(name, session) {
            //DBG(arguments,true);
            //console.log('name',name,'session',session);

            //GHETTO: hack to let a plain string work as a document for auto complete only. need to comeback and fix (make it add a editor or editor session from the string)
            if (session.constructor.name === 'String') {
                doc = newAceEditSession(doc);
            }
            var data = {
                doc: session,
                name: name,
                changed: null
            };

            session.on("change", this.trackChange); //this works as on change is valid for session
            var value = docValue(this, data);

            this.server.addFile(name, value);
            return this.docs[name] = data;
        },
        /**
         * Remove a file from tern server
         * @param {string} name = name of file (should be full path)
         */
        delDoc: function(name) {
            var found = this.docs[name];
            if (!found) return;
            try { //stop tracking changes
                found.doc.off("change", this.trackChange);
            }
            catch (ex) {}
            delete this.docs[name];
            this.server.delFile(name);
        },
        /**
         * Call this right before changing to a different doc, it will close tooltips and if the document changed, it will send the latest version to the tern sever
         * @param {bool} [doNotCloseTips=false] pass ture to leave tips open, useful for reference tips that go across docs
         */
        hideDoc: function(name, doNotCloseTips) {
            if(!doNotCloseTips){
                closeAllTips();
            }
            var found = this.docs[name];
            if (found && found.changed) sendDoc(this, found);
        },
        /**
         * Refreshes current document on tern server (forces send, useful for debugging as ideally this should not be needed)
         * [TODO:translateToSession]
         */
        refreshDoc: function(editor) {
            var doc = findDoc(this, editor);
            sendDoc(this, doc);
            var el = document.createElement('span');
            el.setAttribute('style', 'color:green;');
            el.innerHTML = "Tern document refreshed";
            tempTooltip(editor, el, 1000);
        },
        /**
         * Gets completions to display in editor when Ctrl+Space is pressed; This is called by
         * CodeMirror equivalent: complete()
         */
        getCompletions: function(editor, session, pos, prefix, callback) {
            getCompletions(this, editor, session, pos, prefix, callback);
        },
        /**
         * Shows javascript type (example: function, string, custom object, etc..) at current cursor location
         */
        showType: function(cm, pos, calledFromCursorActivity) {
            showType(this, cm, pos, calledFromCursorActivity);
        },
        /**
         * Shows arugments hints as tooltip at current cursor location if inside of function call
         */
        updateArgHints: function(editor) {
            updateArgHints(this, editor);
        },
        /**
         * Jumps to definition of object that the cursor is currently on
         */
        jumpToDef: function(editor) {
            jumpToDef(this, editor);
        },
        /**
         * Jumps to previos location after using jumpToDef
         */
        jumpBack: function(editor) {
            jumpBack(this, editor);
        },
        /**
         * Opens prompt to rename current variable and update references
         */
        rename: function(editor) {
            rename(this, editor);
        },
        /**
         * Finds references to variable at current cursor location and shows tooltip
         */
        findRefs: function(editor) {
            findRefs(this, editor);
        },
        /**
         * unknown - NOT CONVERTED
         */
        selectName: function(cm) {
            selectName(this, cm);
        },
        /**
         * Sends request to tern server
         * @param {bool} [forcePushChangedfile=false] - hack, force push large file change
         * @param {int} [timeout=1000] - timeout for the query
         */
        request: function(editor, query, c, pos, forcePushChangedfile, timeout) {
            var self = this;
            var doc = findDoc(this, editor.getSession());
            var request = buildRequest(this, doc, query, pos, forcePushChangedfile, timeout);

            this.server.request(request, function(error, data) {
                if (!error && self.options.responseFilter) data = self.options.responseFilter(doc, query, request, error, data);
                c(error, data);
            });
        },
        /**
         * returns true if tern should be enabled at current mode (checks for javascript mode or inside of javascript in html mode)
         */
        enabledAtCurrentLocation: function(editor) {
            return inJavascriptMode(editor);
        },
        /**
         * gets a call posistion {start: {line,ch}, argpos: number} if editor's cursor location is currently in a function call, otherwise returns undefined
         * @param {row,column} [pos] optionally pass this to check for call at a posistion other than current cursor posistion
         */
        getCallPos: function(editor, pos) {
            return getCallPos(editor, pos);
        },
        /**
         * (ghetto and temporary). Call this when current doc changes, it will delete all docs on the server then add current doc
         */
        /* 10.4.2014- copied from CartTern, dont think this is needed as it was for tab switching issues
        docChanged: function(editor) {
            //delete all docs
            for (var p in this.docs) {
                this.delDoc(p);
            }
            //add current doc
            this.addDoc("current", editor);
            console.log('checking for VS refs because Doc changed... DISABLE when done with adding correct editorSession interface');
            loadTernRefs(this, editor);
        },*/
        /**
         * (ghetto) (for web worker only) needed to update plugins and options- tells web worker to kill current tern server and start over as options and plugins can only be set during initialization
         * Need to call this after changing any plugins
         */
        restart: function() {
            if (!this.options.useWorker) return;
            this.server.restart(this);
        },
        /**
         * sends debug message to worker (TEMPORARY) for testing
         */
        debug: function(message) {
            if (!message) {
                console.log('debug commands: files, filecontents');
                return;
            }
            if (!this.options.useWorker) return;
            this.server.sendDebug(message);
        },
    };

    exports.TernServer = TernServer;
    //#endregion


    //#region TernServerPrivate

    /**
     * gets file (called by requirejs plugin and possibly other places)
     */
    function getFile(ts, name, cb) {
        //DBG(arguments,true); - example : util/dom2.js
        console.log('getFile - name:', name);
        var buf = ts.docs[name];
        if (buf) cb(docValue(ts, buf));
        else if (ts.options.getFile) ts.options.getFile(name, cb);
        else cb(null);
    }
    /**
     * Finds document on the tern server, or adds new doc if does not exist
     * @param {TernServer} ts
     * @param {editSession} session
     * @param {string} [name] - pass name for new doc if it needs to be added (or leave blank and it will be auto generated)
     * @returns ternDoc
     */
    function findDoc(ts, session, name) {
        for (var n in ts.docs) {
            var cur = ts.docs[n];
            if (cur.doc == session) return cur;
        }
        //still going: no doc found, add a new one
        if (!name) for (var i = 0;; ++i) {
            n = "[doc" + (i || "") + "]"; //name not passed for new doc, so auto generate it
            if (!ts.docs[n]) {
                name = n;
                break;
            }
        }
        return ts.addDoc(name, session);
    }
    /**
     * Converts ace CursorPosistion {row,column} to tern posistion {line,ch}
     */
    function toTernLoc(pos) {
        if (pos.row) {
            return {
                line: pos.row,
                ch: pos.column
            };
        }
        return pos;
    }
    /**
     * Converts tern location {line,ch} to ace posistion {row,column}
     */
    function toAceLoc(pos) {
        if (pos.line) {
            return {
                row: pos.line,
                column: pos.ch
            };
        }
        return pos;
    }
    /**
     * Build request to tern server
     * @param {TernDoc} doc - {doc: editSession, name: name of document, changed: {from:int, to:int}}
     * @param {bool} [forcePushChangedfile=false] - hack, force push large file change
     * @param {int} [timeout=1000] - timeout for the query
     */
    function buildRequest(ts, doc, query, pos, forcePushChangedfile, timeout) {
        /*
         * the doc passed here is {changed:null, doc:Editor, name: "[doc]"}
         * not the same as editor.getSession().getDocument() which is: {$lines: array}  (the actual document content
         */
        var files = [],
            offsetLines = 0,
            allowFragments = !query.fullDocs;
        if (!allowFragments) {
            delete query.fullDocs;
        }
        if (typeof query == "string") {
            query = {
                type: query
            };
        }

        // lineCharPositions makes the tern result a position instead of a file offset integer. From Tern: Offsets into a file can be either (zero-based) integers, or {line, ch} objects, where both line and ch are zero-based integers. Offsets returned by the server will be integers, unless the lineCharPositions field in the request was set to true, in which case they will be {line, ch} objects.

        query.lineCharPositions = true;

        //build the query start and end based on current cusor location of editor
        //NOTE: DO NOT use '===' for query.end == null below as it returns a different result!
        if (query.end == null) { //this is null for get completions
            var currentSelection = doc.doc.getSelection();
            query.end = toTernLoc(pos || currentSelection.selectionLead);
            if (currentSelection.selectionAnchor != currentSelection.selectionLead) {
                query.start = toTernLoc(currentSelection.selectionAnchor);
            }
            /* this code was when editor was attached to doc instead of session
                    var currentSelection = doc.doc.getSelectionRange(); //returns range: start{row,column}, end{row,column}
                    query.end = toTernLoc(pos || currentSelection.end);
                    if (currentSelection.start != currentSelection.end) {
                        query.start = toTernLoc(currentSelection.start);
                    }*/
        }

        var startPos = query.start || query.end;
        if (doc.changed) {
            //forcePushChangedfile && = HACK- for some reason the definition is not working properly with large files while pushing only a fragment... need to fix this! until then, we are just pushing the whole file, which is very inefficient
            //doc > 250 lines & doNot allow fragments & less than 100 lines changed and something else....
            if (!forcePushChangedfile && doc.doc.getLength() > bigDoc && allowFragments !== false && doc.changed.to - doc.changed.from < 100 && doc.changed.from <= startPos.line && doc.changed.to > query.end.line) {
                files.push(getFragmentAround(doc, startPos, query.end));
                query.file = "#0";
                var offsetLines = files[0].offsetLines;
                if (query.start != null) query.start = Pos(query.start.line - -offsetLines, query.start.ch);
                query.end = Pos(query.end.line - offsetLines, query.end.ch);
            }
            else {
                files.push({
                    type: "full",
                    name: doc.name,
                    text: docValue(ts, doc)
                });
                query.file = doc.name;
                doc.changed = null;
            }
        }
        else {
            query.file = doc.name;
        }

        //push changes of any docs on server that are NOT this doc so that they are up to date for tihs request
        for (var name in ts.docs) {
            var cur = ts.docs[name];
            if (cur.changed && cur != doc) {
                files.push({
                    type: "full",
                    name: cur.name,
                    text: docValue(ts, cur)
                });
                cur.changed = null;
            }
        }

        return {
            query: query,
            files: files,
            timeout: timeout | 1000
        };
    }
    /**
     * Used to get a fragment of the current document for updating the documents changes to push to the tern server (more efficient than pushing entire document on each change)
     * @param {ternDoc} data
     */
    function getFragmentAround(data, start, end) {
        var session = data.doc;
        var minIndent = null,
            minLine = null,
            endLine,
            tabSize = session.$tabSize;
        for (var p = start.line - 1, min = Math.max(0, p - 50); p >= min; --p) {
            var line = session.getLine(p),
                fn = line.search(/\bfunction\b/);
            if (fn < 0) continue;
            var indent = countColumn(line, null, tabSize);
            if (minIndent != null && minIndent <= indent) continue;
            minIndent = indent;
            minLine = p;
        }
        if (minLine == null) minLine = min;
        var max = Math.min(session.getLength() - 1, end.line + 20);
        if (minIndent == null || minIndent == countColumn(session.getLine(start.line), null, tabSize)) endLine = max;
        else for (endLine = end.line + 1; endLine < max; ++endLine) {
            var indent = countColumn(session.getLine(endLine), null, tabSize);
            if (indent <= minIndent) break;
        }
        var from = Pos(minLine, 0);

        return {
            type: "part",
            name: data.name,
            offsetLines: from.line,
            text: session.getTextRange({
                start: toAceLoc(from),
                end: toAceLoc(Pos(endLine, 0))
            })
        };
    }
    /**
     * Copied from CodeMirror source, used in getFragmentAround. Not exactly sure what this does
     */
    function countColumn(string, end, tabSize, startIndex, startValue) {
        if (end == null) {
            end = string.search(/[^\s\u00a0]/);
            if (end == -1) end = string.length;
        }
        for (var i = startIndex || 0, n = startValue || 0; i < end; ++i) {
            if (string.charAt(i) == "\t") n += tabSize - (n % tabSize);
            else ++n;
        }
        return n;
    }
    /**
     * (SES) Gets the text for a doc
     * @param {TernDoc} doc - {doc: EditSession, name: name of document, changed: {from:int, to:int}}
     */
    function docValue(ts, doc) {
        var val = doc.doc.getValue();
        //TODO: find out what this line of code is meant to do:
        if (ts.options.fileFilter) val = ts.options.fileFilter(val, doc.name, doc.doc);
        return val;
    }
    /**
     * Gets a class name for icon based on type for completion popup
     */
    function typeToIcon(type) {
        var suffix;
        if (type == "?") suffix = "unknown";
        else if (type == "number" || type == "string" || type == "bool") suffix = type;
        else if (/^fn\(/.test(type)) suffix = "fn";
        else if (/^\[/.test(type)) suffix = "array";
        else suffix = "object";
        return cls + "completion " + cls + "completion-" + suffix;
    }
    //popup on select cant be bound until its created. This tracks if its bound
    var popupSelectBound = false;
    /**
     * called to get completions, equivalent to cm.tern.hint(ts,cm,c)
     * NOTE: current implmentation of this has this method being called by the language_tools as a completor
     */
    function getCompletions(ts, editor, session, pos, prefix, callback) {
        //9.30.2014- if auto complete fired twice in threshold (defualt 1 second, TODO: add setting for this), then include all text completions; The time is from the last time auto complete finished getting completions to the time this event was fired
        var autoCompleteFiredTwiceInThreshold = function() {
            try {
                var t = ts.lastAutoCompleteFireTime;
                if (!t) {
                    return false;
                }
                var msPassed = new Date().getTime() - t;
                if (msPassed < 1000) { //less than 1 second
                    return true;
                }
            }
            catch (ex) {
                showError('autoCompleteFiredTwiceInThreshold error:' + ex);
            }
            return false;
        };
        var forceEnableAceTextCompletor = autoCompleteFiredTwiceInThreshold();

        ts.request(editor, {
            type: "completions",
            types: true,
            origins: true,
            docs: true,
            filter: false,
            omitObjectPrototype: false,
            sort: false,
            includeKeywords: true,
            guess: true,
            expandWordForward: true
        },

        function(error, data) {
            if (error) {
                return showError(editor, error);
            }
            //map ternCompletions to correct format
            var ternCompletions = data.completions.map(function(item) {
                return {
                    /*add space before icon class so Ace Prefix doesnt mess with it*/
                    iconClass: " " + (item.guess ? cls + "guess" : typeToIcon(item.type)),
                    doc: item.doc,
                    type: item.type,
                    caption: item.name,
                    value: item.name,
                    score: 99999,
                    /*replace gets file name from path tomake it shorter while showing in popup*/
                    meta: item.origin ? item.origin.replace(/^.*[\\\/]/, '') : "tern"
                };
            });


            //#region OtherCompletions
            var otherCompletions = [];
            //if basic auto completion is on, then get keyword completions that are not found in tern results
            if (editor.getOption('enableBasicAutocompletion') === true) {
                try {
                    otherCompletions = editor.session.$mode.getCompletions();
                }
                catch (ex) {
                    //TODO: this throws error when using tern in script tags in mixed html mode- need to fix this(not critical, but missing keyword completions when using html mixed)
                }
            }
            if ((forceEnableAceTextCompletor || ternCompletions.length === 0) && ts.aceTextCompletor) {
                //console.time('aceTextCompletor');
                var textCompletions = [];
                //9.30.2014- sometimes tern just fails with complex javascript.. If this is the case, lets use the built in ace text completor to get information instead of the more advanced 'local strings' below;
                //this is only used when tern fails as it will contain stuff that tern should already contain, but when tern fails this stuff is all missing so get it how ever we can
                //note that this can easily take 100ms to get these completions and merge them
                try {
                    ts.aceTextCompletor.getCompletions(editor, session, pos, prefix, function(error, data) {
                        textCompletions = data.map(function(item) {
                            return {
                                doc: item.doc,
                                type: item.type,
                                caption: item.name,
                                value: item.name,
                                /*score: -1*/
                                meta: 'aceTextCompletor'
                            };
                        });
                        //returns true if passed value already exists in otherCompletions
                        var otherCompletionsContains = function(value, minLength) {
                            value = value.toLowerCase().trim();
                            if (value.length < 2) {
                                //dont want 1 character completions!
                                return true;
                            }
                            var isDupe = false;
                            for (var i = 0; i < otherCompletions.length; i++) {
                                if (otherCompletions[i].value.toString().toLowerCase() == value) {
                                    isDupe = true;
                                    break;
                                }
                            }
                            return isDupe;
                        };

                        //merge with other completions
                        for (var z = 0; z < textCompletions.length; z++) {
                            var item = textCompletions[z];
                            if (otherCompletionsContains(item.value)) {
                                continue;
                            }
                            otherCompletions.push(item);
                        }
                    });
                }
                catch (ex) {
                    showError(ts, editor, 'ace text completor error:' + ex);
                }
                //console.log('textCompletions',textCompletions); console.log('otherCompletions',otherCompletions);
                //console.timeEnd('aceTextCompletor');
            }
            else {
                //add local string completions if enabled, this is far more useful than the local text completions
                // gets string tokens that have no spaces or quotes that are longer than min length, tested on 5,000 line doc and takes about ~10ms
                var ternLocalStringMinLength = editor.getOption('ternLocalStringMinLength');
                if (ternLocalStringMinLength > 0) {
                    for (var i = 0; i < editor.session.getLength(); i++) {
                        var tokens = editor.session.getTokens(i);
                        for (var n = 0; n < tokens.length; n++) {
                            var t = tokens[n];
                            if (t.type === 'string') {
                                var val = t.value.toString().substr(1, t.value.length - 2).trim(); //remove first and last quotes
                                if (val.length >= ternLocalStringMinLength && val.indexOf(' ') === -1 && val.indexOf('\'') === -1 && val.indexOf('"') === -1) {
                                    var isDuplicate = false;
                                    if (otherCompletions.length > 0) {
                                        for (var x = 0; x < otherCompletions.length; x++) {
                                            if (otherCompletions[x].value.toString() === val) {
                                                isDuplicate = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (!isDuplicate) {
                                        otherCompletions.push({
                                            meta: 'localString',
                                            name: val,
                                            value: val,
                                            score: -1
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            //now merge other completions with tern (tern has priority)
            //tested on 5,000 line doc with all other completions and takes about ~10ms
            if (otherCompletions.length > 0) {
                var mergedCompletions = ternCompletions.slice(); //copy array
                for (var n = 0; n < otherCompletions.length; n++) {
                    var b = otherCompletions[n];
                    var isDuplicate = false;
                    for (var i = 0; i < ternCompletions.length; i++) {
                        if (ternCompletions[i].value.toString() === b.value.toString()) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    if (!isDuplicate) {
                        mergedCompletions.push(b);
                    }
                }
                ternCompletions = mergedCompletions.slice();
            }
            //#endregion


            //callback goes to the lang tools completor
            callback(null, ternCompletions);

            var tooltip = null;
            //COMEBACK: also need to bind popup close and update (update likely means when the tooltip has to move) (and hoever over items should move tooltip)

            if (!bindPopupSelect()) {
                popupSelectionChanged(); //call once if popupselect bound exited to show tooltip for first item
            }

            //binds popup selection change, which cant be done until first time popup is created
            function bindPopupSelect() {
                if (popupSelectBound) {
                    return false;
                }
                if (!editor.completer.popup) { //popup not opened yet
                    setTimeout(bindPopupSelect, 100); //try again in 100ms
                    return;
                }
                editor.completer.popup.on('select', popupSelectionChanged);
                editor.completer.popup.on('hide', function() {
                    closeAllTips();
                });
                popupSelectionChanged(); //fire once after first bind
                popupSelectBound = true; //prevent rebinding
            }
            //fired on popup selection change
            function popupSelectionChanged() {
                closeAllTips(); //remove(tooltip); //using close all , but its slower, comeback and remove single if its working right
                //gets data of currently selected completion
                var data = editor.completer.popup.getData(editor.completer.popup.getRow());
                if (!data || !data.doc) { //no comments
                    return;
                }
                //make tooltip
                var node = editor.completer.popup.renderer.getContainerElement();
                tooltip = makeTooltip(node.getBoundingClientRect().right + window.pageXOffset, node.getBoundingClientRect().top + window.pageYOffset, createInfoDataTip(data,true), editor);
                tooltip.className += " " + cls + "hint-doc";
            }

            //9.30.2014- track last time auto complete was fired
            try {
                ts.lastAutoCompleteFireTime = new Date().getTime();
            }
            catch (ex) {
                showError(ts, editor, 'error with last autoCompleteFireTime: ' + ex);
            }
        });
    }
    /**
     * [TODO:translateToSession]
     * shows type info
     * @param {bool} calledFromCursorActivity - TODO: add binding on cursor activity to call this method with this param=true to auto show type for functions only
     */
    function showType(ts, editor, pos, calledFromCursorActivity) {
        if (calledFromCursorActivity) { //check if currently in call, if so, then exit
            if (editor.completer && editor.completer.popup && editor.completer.popup.isOpen) return;
            if (!isOnFunctionCall(editor)) return;
        }
        else { //run this check here if not from cursor as this is run in isOnFunctionCall() above if from cursor
            if (!inJavascriptMode(editor)) {
                return;
            }
        }

        var cb = function(error, data) {
            var tip = '';
            if (error) {
                if (calledFromCursorActivity) {
                    return;
                }
                return showError(ts, editor, error);
            }
            if (ts.options.typeTip) { //this is not entered in Morgans tests
                tip = ts.options.typeTip(data);
            }
            else {
                //cursor activity
                if (calledFromCursorActivity) {
                    if (data.hasOwnProperty('guess') && data.guess === true) return; //dont show guesses on auto activity as they are not accurate
                    if (data.type == "?" || data.type == "string" || data.type == "number" || data.type == "bool" || data.type == "date" || data.type == "fn(document: ?)" || data.type == "fn()") {
                        return;
                    }
                    //logO(data, 'data');
                }
                tip = createInfoDataTip(data,true);
            }
            //10ms timeout because jumping the cusor around alot often causes the reported cusor posistion to be the last posistion it was in instaed of its current posistion
            setTimeout(function() {
                var place = getCusorPosForTooltip(editor);
                // console.log('place',place);
                // setTimeout(function(){console.log('place after 1ms', getCusorPosForTooltip(editor));},1);
                makeTooltip(place.left, place.top, tip, editor, true); //tempTooltip(editor, tip, -1); - was temp tooltip.. TODO: add temptooltip fn
            }, 10);
        };

        ts.request(editor, {
            type:"type"
        }, cb, pos, !calledFromCursorActivity, (calledFromCursorActivity ? 100 : null));
    }
    /**
     * @returns {element} for tooltip from data
     * @param {object} data - info about an object from tern
     * @param {string} [data.name] - name of object
     * @param {string} [data.doc] - comments (or documentation) 
     * @param {string} [data.url] - url to info about object for creating link
     * @param {string} [data.origin] - source name of the object
     * @param {object[]} [data.params] - result of parseJsDocParams(data.doc) to prevent re-parsing
     * @param {object [data.fnArgs] - result of parseFnType(data.type) to prevent re-parsing
     * @param {bool} [includeType=false] - pass true to include object type (which is small bold part at top of tip), will only be included if jsDoc params could not be parsed
     * @param {int} [activeArg] pass posistion of active argument if in arg hints (fist arg is 0)
     */
    function createInfoDataTip(data, includeType, activeArg){
        //log('data', data, 'includeType', includeType, 'parseFnType(data.type)', parseFnType(data.type));
        //TODO: add links in tooltip: jumpto, find refs
        tip = elt("span", null);
    
        var d = data.doc;
        var params =data.params ||  parseJsDocParams(d); //parse params
    
        if (includeType) {
            var fnArgs = data.fnArgs ? data.fnArgs : data.type ? parseFnType(data.type) : null; //will be null if parseFnType detects that this is not a function 
            if (fnArgs) {
                /**
                 * gets param info from comments or tern (prefers comments), returns null or empty array if not found (empty array if getChildren=true)
                 * @param {object} arg - name and type
                 * @param {bool} getChildren - if true, will return array of child params
                 */
                var getParam = function(arg, getChildren) {
                    if (params === null) return null;
                    if (!arg.name) return null;
                    var children = [];
                    for (var i = 0; i < params.length; i++) {
                        if (getChildren === true) {
                            if (params[i].parentName.toLowerCase().trim() === arg.name.toLowerCase().trim()) {
                                children.push(params[i]);
                            }
                        }
                        else {
                            if (params[i].name.toLowerCase().trim() === arg.name.toLowerCase().trim()) {
                                return params[i];
                            }
                        }
                    }
                    if (getChildren === true) return children;
                    return null;
                };
                /**
                 * gets name string for param that includes default value and optional
                 */
                var getParamDetailedName = function(param) {
                    var name = param.name;
                    if (param.optional === true) {
                        if (param.defaultValue) {
                            name = "[" + name + "=" + param.defaultValue + "]";
                        }
                        else {
                            name = "[" + name + "]";
                        }
                    }
                    return name;
                };
                //use detailed argHints if called from argHints (activeArg is number) OR there are no params passed from js doc (which means we will let tern interpret param details)
                var useDetailedArgHints = params.length === 0 || !isNaN(parseInt(activeArg));
                var typeStr = '';
                typeStr += data.exprName || data.name || "fn";
                typeStr += "(";
                var activeParam = null,
                    activeParamChildren = []; //one ore more child params for multiple object properties
                    
                
                for (var i = 0; i < fnArgs.args.length; i++) {
                    var paramStr = '';
                    var isCurrent = !isNaN(parseInt(activeArg)) ? i === activeArg : false;
                    var arg = fnArgs.args[i]; //name,type
                    var name = arg.name || "?";
                    if (!useDetailedArgHints) {
                        paramStr += name;
                    }
                    else {
                        var param = getParam(arg, false);
                        var children = getParam(arg, true);
                        var type = arg.type;
                        var optional = false;
                        var defaultValue = '';
                        if (param !== null) {
                            name = param.name;
                            if (param.type) {
                                type = param.type;
                            }
                            if (isCurrent) {
                                activeParam = param;
                            }
                            optional = param.optional;
                            defaultValue = param.defaultValue.trim();
                        }
                        if (children && children.length > 0) {
                            if (isCurrent) {
                                activeParamChildren = children;
                            }
                            type = "{";
                            for (var c = 0; c < children.length; c++) {
                                type += children[c].name;
                                if (c + 1 !== children.length && children.length > 1) type += ", ";
                            }
                            type += "}";
                        }
                        paramStr += type ? '<span class="' + cls + 'type">' + type + '</span> ' : '';
                        paramStr += '<span class="' + cls + (isCurrent ? "farg-current" : "farg") + '">' + (name || "?") + '</span>';
                        if (defaultValue !== '') {
                            paramStr += '<span class="' + cls + 'jsdoc-param-defaultValue">=' + defaultValue + '</span>';
                        }
                        if (optional) {
                            paramStr = '<span class="' + cls + 'jsdoc-param-optionalWrapper">' + '<span class="' + cls + 'farg-optionalBracket">[</span>' + paramStr + '<span class="' + cls + 'jsdoc-param-optionalBracket">]</span>' + '</span>';
                        }
                    }
                    if (i > 0) paramStr = ', ' + paramStr;
                    typeStr += paramStr;
                }
                
                
                typeStr += ")";
                if (fnArgs.rettype) {
                    if (useDetailedArgHints) {
                        typeStr += ' -> <span class="' + cls + 'type">' + fnArgs.rettype + '</span>';
                    }
                    else {
                        typeStr += ' -> ' + fnArgs.rettype;
                    }
                }
                typeStr = '<span class="' + cls + (useDetailedArgHints ? "typeHeader" : "typeHeader-simple") + '">' + typeStr + '</span>'; //outer wrapper
        
                //if this is for arg hints, then show parameter details only for active param
                if(useDetailedArgHints){
                    if (activeParam && activeParam.description) {
                        typeStr += '<div class="' + cls + 'farg-current-description"><span class="' + cls + 'farg-current-name">' + activeParam.name + ': </span>' + activeParam.description + '</div>';
                    }
                    //add active param children details
                    if (activeParamChildren && activeParamChildren.length > 0) {
                        for (var i = 0; i < activeParamChildren.length; i++) {
                            var t = activeParamChildren[i].type ? '<span class="' + cls + 'type">{' + activeParamChildren[i].type + '} </span>' : '';
                            typeStr += '<div class="' + cls + 'farg-current-description">' + t + '<span class="' + cls + 'farg-current-name">' + getParamDetailedName(activeParamChildren[i]) + ': </span>' + activeParamChildren[i].description + '</div>';
                        }
                    }
                }
                tip.appendChild(elFromString(typeStr));
            }
        }
        if(isNaN(parseInt(activeArg))){
            if (data.doc) {
        
                //#region Parse Comments
        
                /**
                 * Replaces param tags and their type, name, description with formatted html;
                 * This is not fullproof (made very quickly)
                 * @param {string} str - comments to parse
                 * @param {object[]} params - result of parseJsDocParams()
                 */
                var replaceParams = function(str, params) {
                    if (params.length === 0) {
                        return str;
                    }
        
                    //#region strip params from input
                    str = str.replace(/@param/gi, '@param'); //make sure all param tags are lowercase
                    var beforeParams = str.substr(0, str.indexOf('@param'));
                    while (str.indexOf('@param') !== -1) {
                        str = str.substring(str.indexOf('@param') + 6); //starting after first param match
                    }
                    //all params have been parsed out but we likely have a fragment of the last params type, name, and description remaining
                    if (str.indexOf('@') !== -1) {
                        str = str.substr(str.indexOf('@')); //start at next tag that is not a param
                    }
                    else {
                        str = ''; //@param was likely the last tag, trim remaining as its likely the end of a param description
                    }
                    //#endregion
        
                    //#region append formatted params to description that is stripped of params
                    var paramStr='';
                    for (var i = 0; i < params.length; i++) {
                        paramStr += '<div>';
                        if (params[i].parentName.trim() === '') {
                            paramStr += '<span class="' + cls + 'jsdoc-tag">@param</span> ';
                        }
                        else {
                            paramStr += '<span class="' + cls + 'jsdoc-tag-param-child">&nbsp;</span> '; //dont show param tag for child param
                        }
                        paramStr += params[i].type.trim() === '' ? '' : '<span class="' + cls + 'type">{' + params[i].type + '}</span> ';
                    
                        if (params[i].name.trim() !== '') {
                            var name = params[i].name.trim();
                            if (params[i].parentName.trim() !== '') {
                                name = params[i].parentName.trim() + '.' + name;
                            }
                            var pName = '<span class="' + cls + 'jsdoc-param-name">' + name + '</span>';
                            if (params[i].defaultValue.trim() !== '') {
                                pName += '<span class="' + cls + 'jsdoc-param-defaultValue">=' + params[i].defaultValue + '</span>';
                            }
                            if (params[i].optional) {
                                pName = '<span class="' + cls + 'jsdoc-param-optionalWrapper">' + '<span class="' + cls + 'farg-optionalBracket">[</span>' + pName + '<span class="' + cls + 'jsdoc-param-optionalBracket">]</span>' + '</span>';
                            }
                            paramStr += pName;
                        }
                        paramStr += params[i].description.trim() === '' ? '' : ' - <span class="' + cls + 'jsdoc-param-description">' + params[i].description + '</span>';
                        paramStr += '</div>';
                    }
                    if(paramStr !== ''){
                        str+= '<div class="'+cls+'jsdoc-param-wrapper">'+paramStr+'</div>';
                    }
                    //#endregion
        
                    return beforeParams + str;
                };
                var highlighTags = function(str) {
                    try {
                        var re = /\s@\w{1,50}\s/gi;
                        var m;
                        //NOTE: regex matches with white space on each side, in replacment below we get rid of white space using trim, this is critical or we will create an infinte loop
                        while ((m = re.exec(str)) !== null) {
                            if (m.index === re.lastIndex) {
                                re.lastIndex++;
                            }
                            str = str.replace(m[0], '<br/><span class="' + cls + 'jsdoc-tag">' + m[0].trim() + '</span> ');
                        }
                    }
                    catch (ex) {
                        showError(ts, editor, ex);
                    }
                    return str;
                };
                var highlightTypes = function(str) {
                    try {
                        var re = /\s{[^}]{1,50}}\s/g;
                        var m;
                        //NOTE: regex matches with white space on each side, in replacment below we get rid of white space using trim, this is critical or we will create an infinte loop
                        while ((m = re.exec(str)) !== null) {
                            if (m.index === re.lastIndex) {
                                re.lastIndex++;
                            }
                            str = str.replace(m[0], ' <span class="' + cls + 'type">' + m[0].trim() + '</span> ');
                        }
                    }
                    catch (ex) {
                        showError(ts, editor, ex);
                    }
                    return str;
                };
        
        
                if (d.substr(0, 1) === '*') {
                    d = d.substr(1); //tern leaves this for jsDoc as they start with /**, not exactly sure why...
                }
                /*if (includeType) {
                    d = " - " + d + " "; //separate from type that starts it, and add end space for regexps to work if last char is a tag
                }*/
                d = d.trim();
                d = replaceParams(d, params);
                d = highlighTags(d);
                d = highlightTypes(d);
                tip.appendChild(elFromString(d));
                //#endregion
            }
            if (data.url) {
                tip.appendChild(document.createTextNode(" "));
                var link = elt("a", null, "[docs]");
                link.target = "_blank";
                link.href = data.url;
                tip.appendChild(link);
            }
            if (data.origin) {
                tip.appendChild(elt("div", null, elt("em", null, "source: " + data.origin)));
            }
        }
        return tip;
    }
    /**
     * Parses jsDoc parameters from function comments
     * @returns {array(name,type,description,optional,defaultValue)}
     */
    function parseJsDocParams(str){
        if (!str) return [];
        str = str.replace(/@param/gi, '@param'); //make sure all param tags are lowercase
        var params = [];
        while (str.indexOf('@param') !== -1) {
            str = str.substring(str.indexOf('@param') + 6); //starting after first param match
            var nextTagStart = str.indexOf('@'); //split on next param (will break if @symbol inside of param, like a link... dont have to time fullproof right now)
    
            var paramStr = nextTagStart === -1 ? str : str.substr(0, nextTagStart);
            var thisParam = {
                name: "",
                //if there is more than one param tag descibing an object with multiple properties, this will be name of parent object; http://stackoverflow.com/questions/6460604/how-to-describe-object-arguments-in-jsdoc/6460748#6460748
                parentName:"",
                type: "",
                description: "",
                optional: false,
                defaultValue: ""
            };
    
            //#region extract type type if any
            var re = /\s{[^}]{1,50}}\s/;
            var m;
            while ((m = re.exec(paramStr)) !== null) {
                if (m.index === re.lastIndex) {
                    re.lastIndex++;
                }
                thisParam.type = m[0];
                paramStr = paramStr.replace(thisParam.type, '').trim(); //remove type from param string
                thisParam.type = thisParam.type.replace('{', '').replace('}', '').replace(' ', '').trim(); //remove brackets and spaces
            }
            //#endregion
    
            //#region parseName
            paramStr = paramStr.trim(); //we now have a single param string starting after the type, next string should be the parameter name
            if (paramStr.substr(0, 1) === '[') {
                thisParam.optional = true;
                var endBracketIdx = paramStr.indexOf(']');
                if (endBracketIdx === -1) {
                    showError('failed to parse parameter name; Found starting \'[\' but missing closing \']\'');
                    continue; //go to next
                }
                var nameStr = paramStr.substring(0, endBracketIdx + 1);
                paramStr = paramStr.replace(nameStr, '').trim(); //remove name portion from param str
                nameStr = nameStr.replace('[', '').replace(']', ''); //remove brackets
                //check for default value that is specified using =
                if (nameStr.indexOf('=') !== -1) {
                    var defaultValue = nameStr.substr(nameStr.indexOf('=') + 1);
                    if (defaultValue.trim() === '') {
                        thisParam.defaultValue = "undefined";
                    }
                    else {
                        thisParam.defaultValue = defaultValue.trim();
                    }
                    thisParam.name = nameStr.substring(0, nameStr.indexOf('=')).trim(); //set name
                }
                else {
                    thisParam.name = nameStr.trim();
                }
            }
            else { //not optional
                var nextSpace = paramStr.indexOf(' ');
                if (nextSpace !== -1) {
                    thisParam.name = paramStr.substr(0, nextSpace);
                    paramStr = paramStr.substr(nextSpace).trim(); //remove name portion from param str
                }
                else{//no more spaces left, next portion of string must be name and there is no description
                    thisParam.name = paramStr;
                    paramStr='';
                }
            }
            var nameDotIdx = thisParam.name.indexOf('.');
            if(nameDotIdx !==-1){
                //NOTE: currently only supporting a single dot for parent name
                thisParam.parentName = thisParam.name.substring(0,nameDotIdx);
                thisParam.name = thisParam.name.substring(nameDotIdx+1);
            }
            //#endregion
    
            //#region parseDescription
            paramStr = paramStr.trim();
            if (paramStr.length > 0) {
                thisParam.description = paramStr.replace('-', '').trim(); //optional hiphen specified before start of description
            }
            //#endregion
    
            params.push(thisParam);
        }
        return params;
    }
    /**
     * Finds all references to the current token
     * @param {function} [cb] - pass a callback to return find refs data result instead of showing tooltip, used internally by rename
     */
    function findRefs(ts, editor, cb) {
        if (!inJavascriptMode(editor)) {
            return;
        }
        ts.request(editor, {
            type: "refs",
            fullDocs: true
        }, function(error, data) {
            if (error) return showError(ts, editor, error);

            //if callback, then send data and quit here
            if (typeof cb === "function") {
                cb(data);
                return;
            }

            //data comes back with name,type,refs{start(ch,line),end(ch,line),file},
            closeAllTips();


            var header = document.createElement("div");
            var title = document.createElement("span");
            title.textContent = data.name + '(' + data.type + ')';
            title.setAttribute("style", "font-weight:bold;");
            header.appendChild(title);

            var tip = makeTooltip(null, null, header, editor, false, - 1);
            //data.name + '(' + data.type + ') References \n-----------------------------------------'

            /*//add close button 10.13.2014- close button is built in
            var closeBtn = elt('span', '', 'close');
            closeBtn.setAttribute('style', 'cursor:pointer; color:red; text-decoration:underline; float:right; padding-left:10px;');
            closeBtn.addEventListener('click', function() {
                remove(tip);
            });
            header.appendChild(closeBtn);*/

            //add divider
            //tip.appendChild(elt('div','','-----------------------------------------------'));

            if (!data.refs || data.refs.length === 0) {
                tip.appendChild(elt('div', '', 'No References Found'));
                return;
            }

            //total refs
            var totalRefs = document.createElement("div");
            totalRefs.setAttribute("style", "font-style:italic; margin-bottom:3px;");
            totalRefs.innerHTML = data.refs.length + " References Found";
            header.appendChild(totalRefs);

            var doc = findDoc(ts, editor.getSession()); //get current doc ref

            //create select input for showing refs
            var refInput = document.createElement("select");
            refInput.setAttribute("multiple", "multiple");
            refInput.addEventListener("change", function() {
                var el = this,
                    selected;
                for (var i = 0; i < el.options.length; i++) {
                    //only allow 1 selected item
                    if (selected) {
                        el[i].selected = false;
                        continue;
                    }
                    //once an item has been selected, grey it out
                    if (el[i].selected) {
                        selected = el[i];
                        selected.style.color = "grey";
                    }
                }
                //read data attributes from selected item
                var file = selected.getAttribute("data-file");
                var start = {
                    "line": selected.getAttribute("data-line"),
                    "ch": selected.getAttribute("data-ch")
                };
                var updatePosDelay = 300;
                var targetDoc = {
                    name: file
                };
                if (doc.name == file) {
                    targetDoc = doc; //current doc
                    updatePosDelay = 50;
                }
                moveTo(ts, editor, doc, targetDoc, start, null, true);
                //move the tooltip to new cusor pos after timeout (hopefully the cursor move is complete after timeout.. ghetto)
                setTimeout(function() {
                    moveTooltip(tip, null, null, editor);
                    closeAllTips(tip); //close any tips that moving this might open, except for the ref tip
                }, updatePosDelay);
            });

            //append line to tooltip for each refeerence
            var addRefLine = function(file, start) {
                var el = document.createElement("option");
                el.setAttribute("data-file", file);
                el.setAttribute("data-line", start.line);
                el.setAttribute("data-ch", start.ch);
                el.text = (start.line + 1) + ":" + start.ch + " - " + file; //add 1 to line because editor does not use line 0
                refInput.appendChild(el);
            };

            //finalize the input after all options are added
            var finalizeRefInput = function() {
                var height = (refInput.options.length * 17);
                height = height > 175 ? 175 : height;
                refInput.style.height = height + "px";
                tip.appendChild(refInput);
            };

            for (var i = 0; i < data.refs.length; i++) {
                var tmp = data.refs[i];
                try {
                    addRefLine(tmp.file, tmp.start);
                    if (i === data.refs.length - 1) {
                        finalizeRefInput();
                    }
                }
                catch (ex) {
                    console.log('findRefs inner loop error (should not happen)', ex);
                }
            }
        });
    }
    /**
     * [TODO:translateToSession]
     * Renames variable at current location
     */
    function rename(ts, editor) {
        /*var token = editor.getTokenAt(editor.getCursor());
            if (!/\w/.test(token.string)) showError(ts, editor, "Not at a variable");*/

        findRefs(ts, editor, function(r) {
            if (!r || r.refs.length === 0) {
                showError(ts, editor, "Cannot rename as no references were found for this variable");
                return;
            }
            /*if(r.type =="global"){
                showError(ts, editor, "Cannot rename global variable yet (variables in different source files cannot be renamed YET, its on TODO list");
                return;
            }*/

            //execute rename
            var executeRename = function(newName) {
                ts.request(editor, {
                    type: "rename",
                    newName: newName,
                    fullDocs: true
                }, function(error, data) {
                    if (error) return showError(ts, editor, error);
                    applyChanges(ts, data.changes, function(result) {
                        //show result tip
                        var resultTip = makeTooltip(null, null, elt("div", "", "Replaced " + result.replaced + " references sucessfully"), editor, true);
                        var errors = elt("div", "");
                        errors.setAttribute("style", "color:red");
                        if (result.replaced != r.refs.length) {
                            errors.textContent = " WARNING! original refs: " + r.refs.length + ", replaced refs: " + result.replaced;
                        }
                        if (result.errors !== "") {
                            errors.textContent += " \n Errors encountered:" + result.errors;
                        }
                        if (errors.textContent !== "") {
                            resultTip.appendChild(errors);
                        }
                    });
                });
            };

            //create tooltip to get new name from user
            var tip = makeTooltip(null, null, elt("div", "", r.name + ": " + r.refs.length + " references found \n (WARNING: this wont work for refs in another file!) \n\n Enter new name:\n"), editor, true);
            var newNameInput = elt('input');
            tip.appendChild(newNameInput);
            try {
                setTimeout(function() {
                    newNameInput.focus();
                }, 100);
            }
            catch (ex) {}

            var goBtn = elt('button', '');
            goBtn.textContent = "Rename";
            goBtn.setAttribute("type", "button");
            goBtn.addEventListener('click', function() {
                remove(tip);
                var newName = newNameInput.value;
                //TODO: add validation of new name (run method that removes invalid varaible names then compare to user input, if dont match then show error)
                if (!newName || newName.trim().length === 0) {
                    showError(ts, editor, "new name cannot be empty");
                    return;
                }

                executeRename(newName);
            });
            tip.appendChild(goBtn);
        });
    }
    //holds original posistion of next change; used inside applyChanges fn
    var nextChangeOrig = 0;
    /**
     * Applys changes for a variable rename.
     * From CodeMirror, not sure exactly how logic works
     * TODO: this only works for current file at the moment!
     */
    function applyChanges(ts, changes, cb) {
        log('changes', changes);
        var Range = ace.require("ace/range").Range; //for ace
        var perFile = Object.create(null);
        for (var i = 0; i < changes.length; ++i) {
            var ch = changes[i];
            (perFile[ch.file] || (perFile[ch.file] = [])).push(ch);
        }

        //result for callback
        var result = {
            replaced: 0,
            status: "",
            errors: ""
        };

        for (var file in perFile) {
            var known = ts.docs[file],
                chs = perFile[file];;
            if (!known) continue;
            chs.sort(function(a, b) {
                return cmpPos(b.start, a.start);
            });
            var origin = "*rename" + (++nextChangeOrig);
            for (var i = 0; i < chs.length; ++i) {
                try {
                    var ch = chs[i];
                    //known.doc.replaceRange(ch.text, ch.start, ch.end, origin);
                    //console.log('ch.text: ' , ch.text , ' ;ch.start: ' , ch.start,' ;ch.end: ' , ch.end ,' ;origin: ' , origin );
                    //NOTE: the origin is used for CodeMirror: When origin is given, it will be passed on to "change" events, and its first letter will be used to determine whether this change can be merged with previous history events, in the way described for selection origins. -- example of origin: *rename1  (TODO: see if ace has some change origin for better history undo)

                    //ch.start and ch.end are {line,ch}
                    ch.start = toAceLoc(ch.start);
                    ch.end = toAceLoc(ch.end);
                    //ace range: function (startRow, startColumn, endRow, endColumn) {
                    known.doc.replace(new Range(ch.start.row, ch.start.column, ch.end.row, ch.end.column), ch.text);
                    result.replaced++;
                }
                catch (ex) {
                    result.errors += '\n ' + file + ' - ' + ex.toString();
                    log('error applying rename changes', ex);
                }
            }
        }
        if (typeof cb === "function") {
            cb(result);
        }
    }
    /**
     * Gets if the cursors current location is on a javascirpt call to a function (for auto showing type on cursor activity as we dont want to show type automatically for everything because its annoying)
     * @returns bool
     */
    function isOnFunctionCall(editor) {
        if (!inJavascriptMode(editor)) return false;
        if (somethingIsSelected(editor)) return false;
        if (isInCall(editor)) return false;

        var tok = getCurrentToken(editor);
        if (!tok) return; //No token at current location
        if (!tok.start) return; //sometimes this is missing... not sure why but makes it impossible to do what we want
        if (tok.type.indexOf('entity.name.function') !== -1) return false; //function definition
        if (tok.type.indexOf('storage.type') !== -1) return false; // could be 'function', which is start of an anon fn

        //check if next token after this one is open parenthesis
        var nextTok = editor.session.getTokenAt(editor.getSelectionRange().end.row, (tok.start + tok.value.length + 1));
        if (!nextTok || nextTok.value !== "(") return false;

        return true;
    }
    /**
     * Returns true if something is selected in the editor (meaning more than 1 character)
     */
    function somethingIsSelected(editor) {
        return editor.getSession().getTextRange(editor.getSelectionRange()) !== '';
    }
    /**
     * gets cursor posistion for opening tooltip below the cusor.
     * @returns {object} - {top:number, left:number)
     */
    function getCusorPosForTooltip(editor) {
        //there is likely a better way to do this...
        var place = editor.renderer.$cursorLayer.getPixelPosition(); //this gets left correclty, but not top if there is scrolling
        place.top = editor.renderer.$cursorLayer.cursors[0].offsetTop; //this gets top correctly regardless of scrolling, but left is not correct
        place.top += editor.renderer.scroller.getBoundingClientRect().top; //top offset of editor on page
        place.left += editor.renderer.container.offsetLeft;
        //45 and 17 are arbitrary numbers that seem to put the tooltip in the right place
        return {
            left: place.left + 45,
            top: place.top + 17
        };
    }
    /**
     * Gets token at current cursor posistion. Returns null if none
     */
    function getCurrentToken(editor) {
        try {
            var pos = editor.getSelectionRange().end;
            return editor.session.getTokenAt(pos.row, pos.column);
        }
        catch (ex) {
            showError(ts, editor, ex);
        }
    }


    //#region ArgHints
    /**
     * gets a call posistion {start: {line,ch}, argpos: number} if editor's cursor location is currently in a function call, otherwise returns undefined
     * @param {row,column} [pos] optionally pass this to check for call at a posistion other than current cursor posistion
     */
    function getCallPos(editor, pos) {
        if (somethingIsSelected(editor)) return;
        if (!inJavascriptMode(editor)) return;
        var start = {}; //start of query to tern (start of the call location)
        var currentPosistion = pos || editor.getSelectionRange().start; //{row,column}
        currentPosistion = toAceLoc(currentPosistion); //just in case
        var currentLine = currentPosistion.row;
        var currentCol = currentPosistion.column;
        var firstLineToCheck = Math.max(0, currentLine - 6);
        //current character
        var ch = '';
        //current depth of the call based on parenthesis
        var depth = 0;
        //argument posistion
        var argpos = 0;
        //iterate backwards through each row
        for (var row = currentLine; row >= firstLineToCheck; row--) {
            var thisRow = editor.session.getLine(row);
            if (row === currentLine) {
                thisRow = thisRow.substr(0, currentCol);
            } //for current line, only get up to cursor posistion
            for (var col = thisRow.length; col >= 0; col--) {
                ch = thisRow.substr(col, 1);
                if (ch === '}' || ch === ')' || ch === ']') {
                    depth += 1;
                }
                else if (ch === '{' || ch === '(' || ch === '[') {
                    if (depth > 0) {
                        depth -= 1;
                    }
                    else if (ch === '(') {
                        //check before call start to make sure its not a function definition
                        var wordBeforeFnName = thisRow.substr(0, col).split(' ').reverse()[1];
                        if (wordBeforeFnName && wordBeforeFnName.toLowerCase() === 'function') {
                            break;
                        }
                        //Make sure this is not in a comment or start of a if statement
                        var token = editor.session.getTokenAt(row, col);
                        if (token) {
                            if (token.type.toString().indexOf('comment') !== -1 || token.type === 'keyword') {
                                break;
                            }
                        }
                        start = {
                            line: row,
                            ch: col
                        };
                        break;
                    }
                    else {
                        break;
                    }
                }
                else if (ch === ',' && depth === 0) {
                    argpos += 1;
                }
            }
        }
        if (!start.hasOwnProperty('line')) { //start not found
            return;
        }
        return {
            start: toTernLoc(start),
            "argpos": argpos
        }; //convert
    }
    /**
     * Gets if editor is currently in call posistion
     *  @param {row,column} [pos] optionally pass this to check for call at a posistion other than current cursor posistion
     */
    function isInCall(editor, pos) {
        var callPos = getCallPos(editor, pos);
        if (callPos) {
            return true;
        }
        return false;
    }
    /**
     * If editor is currently inside of a function call, this will try to get definition of the function that is being called, if successfull will show tooltip about arguments for the function being called.
     * NOTE: did performance testing and found that scanning for callstart takes less than 1ms
     */
    function updateArgHints(ts, editor) {
        closeArgHints(ts);
        var callPos = getCallPos(editor);
        if (!callPos) {
            return;
        }
        var start = callPos.start;
        var argpos = callPos.argpos;

        //check for arg hints for the same call start, if found, then use them but update the argPos (occurs when moving between args in same call)
        var cache = ts.cachedArgHints;
        if (cache && cache.doc == editor && cmpPos(start, cache.start) === 0) {
            return showArgHints(ts, editor, argpos);
        }

        //still going: get arg hints from server
        ts.request(editor, {
            type: "type",
            preferFunction: true,
            end: start
        }, function(error, data) {
            if (error) {
                //TODO: get this error a lot, likely because its trying to show arg hints where there is not a call, need update the method for finding call above to be more accurate
                if (error.toString().toLowerCase().indexOf('no expression at the given position') === -1) {
                    return showError(ts, editor, error);
                }
            }
            if (error || !data.type || !(/^fn\(/).test(data.type)) {
                return;
            }
            ts.cachedArgHints = {
                start: start,
                type: parseFnType(data.type),
                name: data.exprName || data.name || "fn",
                guess: data.guess,
                doc: editor,
                comments: data.doc //added by morgan- include comments with arg hints
            };
            showArgHints(ts, editor, argpos);
        });
    }
    /**
     * Displays argument hints as tooltip
     * @param {int} pos - index of the current parameter that the cursor is located at (inside of parameters)
     */
    function showArgHints(ts, editor, pos) {
        //TODO: add a button in this tooltip that wil get full type info instead of the simplied info
        closeArgHints(ts);
        var cache = ts.cachedArgHints,
            tp = cache.type,
            comments = cache.comments; //added by morgan to include document comments
    
        //parse comments to use for type!
        if (!cache.hasOwnProperty('params')) {
            if (!cache.comments) {
                cache.params = null;
            }
            else {
                var params = parseJsDocParams(cache.comments);
                if (!params || params.length === 0) {
                    cache.params = null;
                }
                else {
                    cache.params = params;
                }
            }
        }
    
        var place = getCusorPosForTooltip(editor);
        var data = {
            name: cache.name,
            guess: cache.guess,
            fnArgs: cache.type,
            doc: cache.comments,
            params: cache.params,
        };
        var tip = createInfoDataTip(data, true, pos);
        ts.activeArgHints = makeTooltip(place.left, place.top, tip, editor, true);
        return;
        
        /*
            var getParam=function(arg, getChildren){
                if(cache.params===null)return null;
                if(!arg.name)return null;
                var children=[];
                for (var i = 0; i < cache.params.length; i++) {
                    if(getChildren===true){
                        if (cache.params[i].parentName.toLowerCase().trim() === arg.name.toLowerCase().trim()) {
                            children.push(cache.params[i]);
                        }
                    }
                    else{
                        if (cache.params[i].name.toLowerCase().trim() === arg.name.toLowerCase().trim()) {
                            return cache.params[i];
                        }
                    }
                }
                if(getChildren===true) return children;
                return null;
            };
          
            var getParamDetailedName= function(param){
                var name = param.name;
                if(param.optional===true){
                    if (param.defaultValue) {
                        name = "[" + name + "=" + param.defaultValue + "]";
                    }
                    else {
                        name = "[" + name + "]";
                    }
                }
                return name;
            };
            
            var tip = elt("span", cache.guess ? cls + "fhint-guess" : null,
            elt("span", cls + "fname", cache.name), "(");
            
            var activeParam=null,
            activeParamChildren=[];//one ore more child params for multiple object properties
            for (var i = 0; i < tp.args.length; ++i) {
                var isCurrent = i == pos;
                if (i) tip.appendChild(document.createTextNode(", "));
                var arg = tp.args[i];//name,type
                
                //added by morgan: use param comments if available
                var param = getParam(arg,false);
                var children =  getParam(arg, true);;
                var name= arg.name || "?";
                var type = arg.type;
                if(param!==null){
                    name = getParamDetailedName(param);
                    if(param.type){
                        type=param.type;
                    }
                    if(isCurrent){
                        activeParam=param;
                    }
                }
                if(children && children.length>0){
                    if(isCurrent){
                        activeParamChildren = children;
                    }
                    type ="{";
                    for (var i = 0; i < children.length; i++) {
                        type+= children[i].name;
                        if(i+1 !== children.length && children.length>1) type+=", ";
                    }
                    type+="}";
                }
                
                tip.appendChild(elt("span", cls + "farg" + (isCurrent? " " + cls + "farg-current" : ""), name || "?"));
                if (type != "?") {
                    tip.appendChild(document.createTextNode(":\u00a0"));
                    tip.appendChild(elt("span", cls + "type", type));
                }
            }
            tip.appendChild(document.createTextNode(tp.rettype ? ") ->\u00a0" : ")"));
            if (tp.rettype) tip.appendChild(elt("span", cls + "type", tp.rettype));//TODO: add return type from comments
            
            //add active param details
            if(activeParam && activeParam.description){
                tip.appendChild(elFromString('<div class="'+cls+'farg-current-description"><span class="'+cls+'farg-current-name">'+activeParam.name+': </span>'+activeParam.description+'</div>'));
            }
            //add active param children details
            if(activeParamChildren && activeParamChildren.length>0){
                
                for (var i = 0; i < activeParamChildren.length; i++) {
                    var t = activeParamChildren[i].type? '<span class="' + cls + 'type">{' + activeParamChildren[i].type+ '} </span>' : '';
                    tip.appendChild(elFromString('<div class="'+cls+'farg-current-description">'+t+'<span class="'+cls+'farg-current-name">'+getParamDetailedName(activeParamChildren[i])+': </span>'+activeParamChildren[i].description+'</div>'));
                }
            }
    
            //get cursor location- there is likely a better way to do this...
            var place = getCusorPosForTooltip(editor);
            ts.activeArgHints = makeTooltip(place.left, place.top, tip, editor, true); //note: this closes on scroll and cursor activity, so the closeArgHints call at the top of this wont need to remove the tip
            */
    }
    /**
     * Parses result of terns type string into an array of arguments and a return type
     * @returns {null | (args:array(name,type), rettype)} null if failed to parse
     */
    function parseFnType(text) {
        if (text.substring(0, 2) !== 'fn') return null;//not a function
        if (text.indexOf('(') === -1) return null;
        
        var args = [],
            pos = 3;

        function skipMatching(upto) {
            var depth = 0,
                start = pos;
            for (;;) {
                var next = text.charAt(pos);
                if (upto.test(next) && !depth) return text.slice(start, pos);
                if (/[{\[\(]/.test(next))++depth;
                else if (/[}\]\)]/.test(next))--depth;
                ++pos;
            }
        }

        // Parse arguments
        if (text.charAt(pos) != ")") for (;;) {
            var name = text.slice(pos).match(/^([^, \(\[\{]+): /);
            if (name) {
                pos += name[0].length;
                name = name[1];
            }
            args.push({
                name: name,
                type: skipMatching(/[\),]/)
            });
            if (text.charAt(pos) == ")") break;
            pos += 2;
        }

        var rettype = text.slice(pos).match(/^\) -> (.*)$/);
        //logO(args, 'args'); logO(rettype, 'rettype');//nothing
        return {
            args: args,
            rettype: rettype && rettype[1]
        };
    }
    //#endregion


    //#region tooltips
    /**
     * returns the difference of posistion a - posistion b (returns difference in line if any, then difference in ch if any)
     * Will return 0 if posistions are the same; (note: automatically converts to ternPosistion)
     * @param {line,ch | row,column} a - first posistion
     * @param {line,ch | row,column} b - second posistion
     */
    function cmpPos(a, b) {
        //if lines matches (result is 0), then returns difference in character
        a = toTernLoc(a);
        b = toTernLoc(b);
        return a.line - b.line || a.ch - b.ch;
    }
    /**
     * not done
     */
    function dialog(cm, text, f) {
        alert('need to implment dialog');
    }
    /**
     * (10.10.2014) Creates document fragment (element) from html string
     */
    function elFromString(s){
        var frag = document.createDocumentFragment(),
            temp = document.createElement('span');
        temp.innerHTML = s;
        while (temp.firstChild) {
            frag.appendChild(temp.firstChild);
        }
        return frag;
    }
    /**
     * Creates element
     */
    function elt(tagname, cls /*, ... elts*/ ) {
        var e = document.createElement(tagname);
        if (cls) e.className = cls;
        for (var i = 2; i < arguments.length; ++i) {
            var elt = arguments[i];
            if (typeof elt == "string") elt = document.createTextNode(elt);
            e.appendChild(elt);
        }
        return e;
    }
    /**
     * (10.10.2014) Creates document fragment (element) from html string
     */
    function elFromString(s){
        var frag = document.createDocumentFragment(),
            temp = document.createElement('span');
        temp.innerHTML = s;
        while (temp.firstChild) {
            frag.appendChild(temp.firstChild);
        }
        return frag;
    }
    /**
     * Closes any open tern tooltips
     * @param {element} [except] - pass an element that should NOT be closed to close all except this
     */
    function closeAllTips(except) {
        var tips = document.querySelectorAll('.' + cls + 'tooltip');
        if (tips.length > 0) {
            for (var i = 0; i < tips.length; i++) {
                if (except && tips[i] == except) {
                    continue;
                }
                remove(tips[i]);
            }
        }
    }
    /**
     * [TODO:translateToSession]
     * Creates tooltip at current cusor location;
     * tooltip will auto close on cursor activity;
     * @param {int} [int_timeout=3000] - pass fadeout time, or -1 to not fade out
     */
    function tempTooltip(editor, content, int_timeout) {
        if (!int_timeout) {
            int_timeout = 3000;
        }
        var location = getCusorPosForTooltip(editor);
        makeTooltip(location.left, location.top, content, editor, true, int_timeout);
    }
    /**
     * Makes a tooltip to show extra info in the editor
     * @param {number} x - x coordinate (relative to document)
     * @param {number} y - y coordinate (relative to document)
     * @param {element} content
     * @param {ace.editor} [editor] - must pass editor if closeOnCusorActivity=true to bind event
     * @param {bool} [closeOnCusorActivity=false] - pass true to bind next cursor activty to destroy this tooltip, this will also bind closing on editor scroll
     * @param {int} [faceOutDuration] - pass a number to make the tooltip fade out (make it temporary)
     */
    function makeTooltip(x, y, content, editor, closeOnCusorActivity, fadeOutDuration) {
        var node = elt("div", cls + "tooltip", content);
        node.style.left = x + "px";
        node.style.top = y + "px";
        document.body.appendChild(node);
        //node.appendChild(elFromString('<a class="'+cls+'tooltip-boxclose" title="close"></a>'));
    
        var closeBtn = document.createElement('a');
        closeBtn.setAttribute('title', 'close');
        closeBtn.setAttribute('class', cls + 'tooltip-boxclose');
        closeBtn.addEventListener('click', function() {
            remove(node);
        });
        node.appendChild(closeBtn);
    
        if (closeOnCusorActivity === true) {
            if (!editor) {
                throw Error('tern.makeTooltip called with closeOnCursorActivity=true but editor was not passed. Need to pass editor!');
            }
            //close tooltip and unbind
            var closeThisTip = function() {
                if (!node.parentNode) return; //not sure what this is for, its from CM
                remove(node);
                editor.getSession().selection.off('changeCursor', closeThisTip);
                editor.getSession().off('changeScrollTop', closeThisTip);
                editor.getSession().off('changeScrollLeft', closeThisTip);
            };
            editor.getSession().selection.on('changeCursor', closeThisTip);
            editor.getSession().on('changeScrollTop', closeThisTip);
            editor.getSession().on('changeScrollLeft', closeThisTip);
        }
    
        if (fadeOutDuration) {
            fadeOutDuration = parseInt(fadeOutDuration, 10);
            if (fadeOutDuration > 100) {
                //fade out tip
                var fadeThistip = function() {
                    if (!node.parentNode) return; //not sure what this is for, its from CM
                    fadeOut(node, fadeOutDuration);
                    try {
                        editor.getSession().selection.off('changeCursor', closeThisTip);
                        editor.getSession().off('changeScrollTop', closeThisTip);
                        editor.getSession().off('changeScrollLeft', closeThisTip);
                    }
                    catch (ex) {}
                }
                setTimeout(fadeThistip, fadeOutDuration);
            }
        }
        return node;
    }
    /**
     * Moves an already open tooltip
     * @param {element} tip
     * @param {number} [x] - coordinate, leave blank to use current cusor pos
     * @param {number} [y] - coordinate, leave blank to use current cusor pos
     */
    function moveTooltip(tip, x, y, editor) {
        if (x === null || y === null) {
            var location = getCusorPosForTooltip(editor);
            x = location.left;
            y = location.top;
        }
        tip.style.left = x + "px";
        tip.style.top = y + "px";
    }
    /**
     * removes node(element) from DOM
     */
    function remove(node) {
        var p = node && node.parentNode;
        if (p) p.removeChild(node);
    }
    /**
     * Fades tooltip out
     */
    function fadeOut(tooltip, int_timeout) {
        if (!int_timeout) {
            int_timeout = 1100;
        }
        if (int_timeout === -1) {
            remove(tooltip);
            return;
        }
        tooltip.style.opacity = "0";
        setTimeout(function() {
            remove(tooltip);
        }, int_timeout);
    }
    /**
     * [TODO:translateToSession]
     * Shows error
     * @param {bool} [noPopup=false] - pass true to log error without showing popUp tooltip with error
     */
    function showError(ts, editor, msg, noPopup) {
        try {
            log('ternError', msg);
            if (!noPopup) {
                var el = elt('span', null, msg);
                el.style.color = 'red';
                tempTooltip(editor, el);
                //tempTooltip(editor, msg.toString());
            }

            /* if (msg && msg.constructor.name === 'Error') {
                
                console.log('ternError', msg);
                return;
            }
            console.log(new Error('ternError: ' + msg));*/
        }
        catch (ex) {
            setTimeout(function() {
                if (typeof msg === undefined) {
                    msg = " (no error passed)";
                }
                throw new Error('tern show error failed.' + msg + '\n\n fail error:' + ex);
            }, 0);
        }
        //DBG(arguments,true);

        //console.log('tern error', new Error('tern error: ' + msg));
        /* dont like this method as it prevents stack trace
        setTimeout(function() {
            throw new Error('tern error: ' + msg);
        }, 0);*/
    }
    /**
     * Closes any active arg hints
     */
    function closeArgHints(ts) {
        if (ts.activeArgHints) {
            remove(ts.activeArgHints);
            ts.activeArgHints = null;
        }
    }
    //#endregion


    //#region JumpTo
    /**
     * jumps to definition of a function or variable where the cursor is currently located
     */
    function jumpToDef(ts, editor) {
        function inner(varName) {
            var req = {
                type: "definition",
                variable: varName || null
            };
            var doc = findDoc(ts, editor.getSession());

            //log('request',buildRequest(ts, doc, req));

            //this calls  function findDef(srv, query, file) {
            ts.server.request(buildRequest(ts, doc, req), function(error, data) {
                //DBG(arguments, true);//REMOVE
                /**
                 *  both the data.origin and data.file seem to contain the full path to the location of what we need to jump to
                 * data contains: context, contextOffset, start (ch,line), end (ch,line), file, origin
                 */

                if (error) return showError(ts, editor, error);
                if (!data.file && data.url) {
                    window.open(data.url);
                    return;
                }

                if (data.file) {
                    var localDoc = ts.docs[data.file];
                    var found;
                    if (localDoc && (found = findContext(localDoc.doc, data))) {
                        ts.jumpStack.push({
                            file: doc.name,
                            start: toTernLoc(editor.getSelectionRange().start), //editor.getCursor("from"), (not sure if correct)
                            end: toTernLoc(editor.getSelectionRange().end) //editor.getCursor("to")
                        });
                        moveTo(ts, editor, doc, localDoc, found.start, found.end);
                        // moveTo(ts, doc, localDoc, found.start, found.end);
                        return;
                    }
                    else { //not local doc- added by morgan... this still needs work as its a hack for the fact that ts.docs does not contain the file we want, instead it only contains a single file at a time. need to fix this (likely needs a big overhaul)
                        //NOTE: my quick hack is going to make jumpting back to previous file not work. needs to be fixed
                        moveTo(ts, editor, doc, {
                            name: data.file
                        }, data.start, data.end);
                        return;
                    }
                }

                showError(ts, editor, "Could not find a definition.");
            });
        }

        /* TODO: need to convert this part or see if its even needed
        if (!atInterestingExpression(editor)) dialog(editor, "Jump to variable", function(name) {
            if (name) inner(name);
        });
        else inner();*/
        inner();
    }
    /**
     * TODO: needs work.. is a mix of the CartTern and the new sesson code
     * Moves editor to a location (or a location in another document)
     * @param {editor} editor - needed to go to line, TODO: figure out how this works with multiple editors and the need to jump from one editor to another
     * @param start - cursor location (can be tern or ace location as it will auto convert)
     * @param end - cursor location (can be tern or ace location as it will auto convert)
     * @param {ternDoc} - curDoc
     * @param {ternDoc} - doc
     * @param {bool} [doNotCloseTip=false] - pass true to NOT close all tips
     */
    function moveTo(ts, editor, curDoc, doc, start, end, doNotCloseTips) {
        // DBG(arguments,true);
        end = end || start; //added 10.4.2014
        if (curDoc != doc) {
            if (ts.options.switchToDoc) {
                if (!doNotCloseTips) {
                    closeAllTips();
                }
                ts.options.switchToDoc(doc.name, toAceLoc(start), toAceLoc(end),doNotCloseTips);
            }
            else {
                showError(ts, 'Need to add editor.ternServer.options.switchToDoc to jump to another document');
            }
            return;
        }
        //still going: current doc, so go to -- PROBLEM: need a way to
        editor.gotoLine(toAceLoc(start).row, toAceLoc(start).column || 0); //this will make sure that the line is expanded
        var sel = curDoc.doc.getSelection();
        sel.setSelectionRange({
            start: toAceLoc(start),
            end: toAceLoc(end)
        });
    }
    /**
     * Jumps back to previous posistion after using JumpTo
     */
    function jumpBack(ts, editor) {
        var pos = ts.jumpStack.pop(),
            doc = pos && ts.docs[pos.file];
        if (!doc) return;
        moveTo(ts, editor, findDoc(ts, editor.getSession()), doc, pos.start, pos.end);
    }
    /**
     * Dont know what this does yet...
     * Marijnh's comment: The {line,ch} representation of positions makes this rather awkward.
     * @param {editSession} session
     * @param {object} data - contains documentation for function, start (ch,line), end(ch,line), file, context, contextOffset, origin
     */
    function findContext(session, data) {
        //DBG(arguments,true);
        var before = data.context.slice(0, data.contextOffset).split("\n");
        var startLine = data.start.line - (before.length - 1);
        var ch = null;
        if (before.length == 1) {
            ch = data.start.ch;
        }
        else {
            ch = session.getLine(startLine).length - before[0].length;
        }
        var start = Pos(startLine, ch);

        var text = session.getLine(startLine).slice(start.ch);
        for (var cur = startLine + 1; cur < session.getLength() && text.length < data.context.length; ++cur) {
            text += "\n" + session.getLine(cur);
        }
        // if (text.slice(0, data.context.length) == data.context)
        // NOTE: this part is commented out and always returns data
        // because there is a bug that is causing it to miss by one char
        // and I dont know when the part below would ever be needed (I guess we will find out when it doesnt work)
        return data;

        //COMEBACK--- need to use session.find.... NOT IN USE RIGHT NOW... need to fix!
        console.log(new Error('This part is not complete, need to implement using Ace\'s search functionality'));
        console.log('data.context', data.context);
        var cursor = session.getSearchCursor(data.context, 0, false); //this will throw error as it was for 'editor' instead of 'session'
        var nearest, nearestDist = Infinity;
        while (cursor.findNext()) {
            var from = cursor.from(),
                dist = Math.abs(from.line - start.line) * 10000;
            if (!dist) dist = Math.abs(from.ch - start.ch);
            if (dist < nearestDist) {
                nearest = from;
                nearestDist = dist;
            }
        }
        if (!nearest) return null;

        if (before.length == 1) nearest.ch += before[0].length;
        else nearest = Pos(nearest.line + (before.length - 1), before[before.length - 1].length);
        if (data.start.line == data.end.line) var end = Pos(nearest.line, nearest.ch + (data.end.ch - data.start.ch));
        else var end = Pos(nearest.line + (data.end.line - data.start.line), data.end.ch);
        return {
            start: nearest,
            end: end
        };
    }
    /**
     * (not exactly sure) Cnoverted=true
     */
    function atInterestingExpression(editor) {
        var pos = editor.getSelectionRange().end; //editor.getCursor("end"),
        var tok = editor.session.getTokenAt(pos.row, pos.column); // editor.getTokenAt(pos);
        pos = toTernLoc(pos);
        if (tok.start < pos.ch && (tok.type == "comment" || tok.type == "string")) {
            // log('not atInterestingExpression');
            return false;
        }
        return /\w/.test(editor.session.getLine(pos.line).slice(Math.max(pos.ch - 1, 0), pos.ch + 1));
        //return /\w/.test(editor.getLine(pos.line).slice(Math.max(pos.ch - 1, 0), pos.ch + 1));
    }
    //#endregion


    /**
     * Called by Hidedoc... Sends document to server
     */
    function sendDoc(ts, doc) {
        ts.server.request({
            files: [{
                type: "full",
                name: doc.name,
                text: docValue(ts, doc)
            }]
        }, function(error) {
            if (error) console.error(error);
            else doc.changed = null;
        });
    }
    /**
     * returns true if current mode is javascript;
     *  TO- make sure tern can work in mixed html mode
     */
    function inJavascriptMode(editor) {
        return getCurrentMode(editor) == 'javascript';
    }
    /**
     * Gets editors mode at cursor posistion (including nested mode) (copied from snipped manager)     *
     */
    function getCurrentMode(editor) {
        var scope = editor.session.$mode.$id || "";
        scope = scope.split("/").pop();
        if (scope === "html" || scope === "php") {
            if (scope === "php") scope = "html";
            var c = editor.getCursorPosition();
            var state = editor.session.getState(c.row);
            if (typeof state === "object") {
                state = state[0];
            }
            if (state.substring) {
                if (state.substring(0, 3) == "js-") scope = "javascript";
                else if (state.substring(0, 4) == "css-") scope = "css";
                else if (state.substring(0, 4) == "php-") scope = "php";
            }
        }
        return scope;
    }
    /**
     * Unknown.. doesnt appear to be used
     */
    function startsWith(str, token) {
        return str.slice(0, token.length).toUpperCase() == token.toUpperCase();
    }
    /**
     * Tracks changes for the ternDocument
     * @param {ternServer} ts
     * @param {editSession} session
     * @param {unknown} change object.. which appears to be built by this function... has from{},to{},text[],origin...
     */
    function trackChange(ts, session, change) {
        //DBG(arguments,true);
        /*log('change', change);
          { change=
	        "data": {
		        "action": "removeText" OR  "insertText",
		        "range": {
			        "start": {
				        "row": 14,
				        "column": 21
			        },
			        "end": {
				        "row": 14,
				        "column": 22
			        }
		        },
		        "text": "0"     -- the text that was changed
	        }
         */


        //convert ace Change event to object that is used in logic below
        var _change = {};
        _change.from = toTernLoc(change.data.range.start);
        _change.to = toTernLoc(change.data.range.end);
        if (change.data.hasOwnProperty('text')) {
            _change.text = [change.data.text];
        }
        else { //text not set when multiple lines changed, instead lines is set as array
            _change.text = change.data.lines;
        }

        var data = findDoc(ts, session);
        var argHints = ts.cachedArgHints;

        if (argHints && argHints.session == session && cmpPos(argHints.start, _change.to) <= 0) {
            ts.cachedArgHints = null;
        }

        var changed = data.changed; //data is the tern server session, which keeps a changed property, which is null here
        if (changed === null) {
            data.changed = changed = {
                from: _change.from.line,
                to: _change.from.line
            };
        }

        var end = _change.from.line + (_change.text.length - 1);
        if (_change.from.line < changed.to) {
            changed.to = changed.to - (_change.to.line - end);
        }
        if (end >= changed.to) {
            changed.to = end + 1;
        }
        if (changed.from > _change.from.line) {
            changed.from = changed.from.line;
        }

        //if session is > 250 lines & more than 100 lines changed, then update entire session on tern server after 200ms.. not sure why the delay
        if (session.getLength() > bigDoc && _change.to - changed.from > 100) {
            setTimeout(function() {
                if (data.changed && data.changed.to - data.changed.from > 100) {
                    sendDoc(ts, data);
                }
            }, 200);
        }
    }

    //#endregion


    //#region WorkerWrapper
    /**
     * Worker wrapper
     */
    function WorkerServer(ts) {
        var worker = new Worker(ts.options.workerScript);

        /**
         * Starts worker server (or can be used to restart with new plugins/options)
         */
        var startServer = function(ts) {
            worker.postMessage({
                type: "init",
                defs: ts.options.defs,
                plugins: ts.options.plugins,
                scripts: ts.options.workerDeps
            });
        };

        startServer(ts); //start

        var msgId = 0,
            pending = {};

        function send(data, c) {
            if (c) {
                data.id = ++msgId;
                pending[msgId] = c;
            }
            //10.4.2014- try catch as something is randomly throwing error here... one thing suggests that the data is not a plain object...
            //failed to execute 'postmessage' on 'worker' an object could not be cloned
            try{
                worker.postMessage(data);
            }
            catch(ex){
                console.log('failed to post message to worker, does the data contain functions? ',data);
                worker.postMessage(JSON.parse(JSON.stringify(data)));//try with plain object as stringify will strip out junk
                throw ex;
            }
        }
        worker.onmessage = function(e) {
            var data = e.data;
            if (data.type == "getFile") {
                getFile(ts, data.name, function(err, text) {
                    send({
                        type: "getFile",
                        err: String(err),
                        text: text,
                        id: data.id
                    });
                });
            }
            else if (data.type == "debug") {
                console.log(data.message);
            }
            else if (data.id && pending[data.id]) {
                pending[data.id](data.err, data.body);
                delete pending[data.id];
            }
        };
        worker.onerror = function(e) {
            for (var id in pending) pending[id](e);
            pending = {};
        };

        this.addFile = function(name, text) {
            send({
                type: "add",
                name: name,
                text: text
            });
        };
        this.delFile = function(name) {
            send({
                type: "del",
                name: name
            });
        };
        this.request = function(body, c) {
            send({
                type: "req",
                body: body
            }, c);
        };
        //sets defs (pass array of strings, valid defs are jquery, underscore, browser, ecma5)
        //COMEBACK-- this doesnt work yet
        this.setDefs = function(arr_defs) {
            send({
                type: "setDefs",
                defs: arr_defs
            });
        };
        //restarts worker's tern instance with updated options/plugins
        this.restart = function(ts) {
            startServer(ts);
            // console.log('COMEBACK: on server restart- need to re-send all docs');//this.sendDebug('files') //THIS APPEARS TO BE FINE .. MAY NEED MORE TESTING
        };
        /**
         *sends a debug message to worker (TEMPORARY)- worker then gets message and does something with it (have to update worker file with commands)
         * @param {string} message- debug type : files|
         */
        this.sendDebug = function(message) {
            send({
                type: "debug",
                body: message
            });
        };
    }
    //#endregion


    //#region CSS
    var dom = require("ace/lib/dom");
    dom.importCssString(".Ace-Tern-tooltip { border: 1px solid silver; border-radius: 3px; color: #444; padding: 2px 5px; padding-right:15px; /*for close button*/ font-size: 90%; font-family: monospace; background-color: white; white-space: pre-wrap; max-width: 40em; max-height:60em; overflow-y:auto; position: absolute; z-index: 10; -webkit-box-shadow: 2px 3px 5px rgba(0, 0, 0, .2); -moz-box-shadow: 2px 3px 5px rgba(0, 0, 0, .2); box-shadow: 2px 3px 5px rgba(0, 0, 0, .2); transition: opacity 1s; -moz-transition: opacity 1s; -webkit-transition: opacity 1s; -o-transition: opacity 1s; -ms-transition: opacity 1s; } .Ace-Tern-tooltip-boxclose { position:absolute; top:0; right:3px; color:red; } .Ace-Tern-tooltip-boxclose:hover { background-color:yellow; } .Ace-Tern-tooltip-boxclose:before { content:'×'; cursor:pointer; font-weight:bold; font-size:larger; } .Ace-Tern-completion { padding-left: 12px; position: relative; } .Ace-Tern-completion:before { position: absolute; left: 0; bottom: 0; border-radius: 50%; font-weight: bold; height: 13px; width: 13px; font-size:11px; /*BYM*/ line-height: 14px; text-align: center; color: white; -moz-box-sizing: border-box; -webkit-box-sizing: border-box; box-sizing: border-box; } .Ace-Tern-completion-unknown:before { content:'?'; background: #4bb; } .Ace-Tern-completion-object:before { content:'O'; background: #77c; } .Ace-Tern-completion-fn:before { content:'F'; background: #7c7; } .Ace-Tern-completion-array:before { content:'A'; background: #c66; } .Ace-Tern-completion-number:before { content:'1'; background: #999; } .Ace-Tern-completion-string:before { content:'S'; background: #999; } .Ace-Tern-completion-bool:before { content:'B'; background: #999; } .Ace-Tern-completion-guess { color: #999; } .Ace-Tern-hint-doc { max-width: 35em; } .Ace-Tern-fhint-guess { opacity: .7; } .Ace-Tern-fname { color: black; } .Ace-Tern-farg { color: #70a; } .Ace-Tern-farg-current { color: #70a; font-weight:bold; font-size:larger; } .Ace-Tern-farg-current-description { font-style:italic; margin-top:2px; color:grey; } .Ace-Tern-farg-current-name { font-weight:bold; } .Ace-Tern-type { color: #07c; font-size:smaller; } .Ace-Tern-jsdoc-tag { color: #B93A38; text-transform: lowercase; font-size:smaller; font-weight:600; } .Ace-Tern-jsdoc-param-wrapper{ /*background-color: #FFFFE3; padding:3px;*/ } .Ace-Tern-jsdoc-tag-param-child{ display:inline-block; width:0px; } .Ace-Tern-jsdoc-param-optionalWrapper { font-style:italic; } .Ace-Tern-jsdoc-param-optionalBracket { color:grey; font-weight:bold; } .Ace-Tern-jsdoc-param-name { color: #70a; font-weight:bold; } .Ace-Tern-jsdoc-param-defaultValue { color:grey; } .Ace-Tern-jsdoc-param-description { color:black; } .Ace-Tern-typeHeader-simple{ font-size:smaller; font-weight:bold; display:block; font-style:italic; margin-bottom:3px; color:grey; } .Ace-Tern-typeHeader{ display:block; font-style:italic; margin-bottom:3px; } ");
    //override the autocomplete width (ghetto)-- need to make this an option
    dom.importCssString(".ace_autocomplete {width: 400px !important;}");
    //#endregion
});