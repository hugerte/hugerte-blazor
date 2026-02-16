console.log("loading js hugerte-blazor");

const hasDisabledSupport = (editor) => false;

const setEditorMode = (editor, mode) => {
  editor.mode.set(mode);
};

const CreateScriptLoader = () => {
  let unique = 0;

  const uuid = (prefix) => {
    const time = Date.now();
    const random = Math.floor(Math.random() * 1000000000);
    unique++;
    return prefix + "_" + random + unique + String(time);
  };
  const state = {
    scriptId: uuid("hugerte-script"),
    listeners: [],
    scriptLoaded: false,
  };

  const injectScript = (scriptId, doc, url, injectionCallback) => {
    const scriptTag = doc.createElement("script");
    scriptTag.referrerPolicy = "origin";
    scriptTag.type = "application/javascript";
    scriptTag.id = scriptId;
    scriptTag.src = url;

    const handler = () => {
      scriptTag.removeEventListener("load", handler);
      injectionCallback();
    };
    scriptTag.addEventListener("load", handler);
    if (doc.head) {
      doc.head.appendChild(scriptTag);
    }
  };

  const load = (doc, url, cb) => {
    if (state.scriptLoaded) {
      cb();
    } else {
      state.listeners.push(cb);
      if (!doc.getElementById(state.scriptId)) {
        injectScript(state.scriptId, doc, url, () => {
          state.listeners.forEach((fn) => fn());
          state.scriptLoaded = true;
        });
      }
    }
  };

  return {
    load,
  };
};

if (!window.hugerteBlazorLoader) {
  window.hugerteBlazorLoader = CreateScriptLoader();
}

const getGlobal = () => (typeof window !== "undefined" ? window : global);

const getHugeRTE = () => {
  const global = getGlobal();
  return global && global.hugerte ? global.hugerte : null;
};

const updateHugeRTEVal = (id, val) => {
  if (getHugeRTE() && getHugeRTE().get(id).getContent() !== val) {
    getHugeRTE().get(id).setContent(val);
  }
};

const rteEventHandler = (() => {
  const eventCache = {};
  const bindEvent = (editor, event, fn) => {
    if (!eventCache[editor.id]) eventCache[editor.id] = [];
    eventCache[editor.id].push({ name: event, fn });
    editor.on(event, fn);
  };
  const unbindEditor = (editorId) => {
    const editor = getHugeRTE().get(editorId);
    eventCache[editorId].forEach((event, i) => {
      editor.off(event.name, event.fn);
    });
    delete eventCache.editorId;
  };
  return {
    bindEvent,
    unbindEditor,
  };
})();

const chunkMap = (() => {
  const map = new Map();
  const next = (streamId, editorId, val, index, size) => {
    const acc = (map.has(streamId) ? map.get(streamId) : "") + val;
    if (index === size) {
      updateHugeRTEVal(editorId, acc);
      map.delete(streamId);
    } else {
      map.set(streamId, acc);
    }
  };
  return {
    push: next,
  };
})();

window.hugerteBlazorWrapper = {
  insertContent: (id, content, args) => {
    const rte = getHugeRTE().get(id);
    rte?.insertContent(content, args);
  },
  updateDisabled: (id, disable) => {
    setEditorMode(getHugeRTE().get(id), disable ? "readonly" : "design");
  },
  updateValue: (id, streamId, value, index, chunks) => {
    chunkMap.push(streamId, id, value, index, chunks);
  },
  init: (el, blazorConf, dotNetRef) => {
    const chunkSize = 16 * 1024;
    const update = (format, content) => {
      const updateFn = format === "text" ? "UpdateText" : "UpdateModel";
      const chunks = Math.floor(content.length / chunkSize) + 1;
      const streamId = (Date.now() % 100000) + "";
      for (let i = 0; i < chunks; i++) {
        const chunk = content.substring(chunkSize * i, chunkSize * (i + 1));
        dotNetRef.invokeMethodAsync(updateFn, streamId, i + 1, chunk, chunks);
      }
    };
    const getJsObj = (objectPath) => {
      const jsConf =
        objectPath !== null && typeof objectPath === "string"
          ? objectPath.split(".").reduce((acc, current) => {
              return acc !== undefined ? acc[current] : undefined;
            }, window)
          : undefined;
      return jsConf !== undefined && typeof jsConf === "object" ? jsConf : {};
    };
    const rteConf = { ...getJsObj(blazorConf.jsConf), ...blazorConf.conf };
    rteConf.inline = blazorConf.inline;
    rteConf.readonly = blazorConf.disabled;
    rteConf.target = el;
    rteConf._setup = rteConf.setup;
    rteConf.setup = (editor) => {
      rteEventHandler.bindEvent(editor, "init", (e) =>
        dotNetRef.invokeMethodAsync("GetValue").then((value) => {
          editor.setContent(value);
        }),
      );
      rteEventHandler.bindEvent(editor, "change", (e) => {
        dotNetRef.invokeMethodAsync("OnChange");
      });
      rteEventHandler.bindEvent(editor, "input", (e) => {
        dotNetRef.invokeMethodAsync("OnInput");
      });
      rteEventHandler.bindEvent(editor, "setcontent", (e) =>
        update("text", editor.getContent({ format: "text" })),
      );
      rteEventHandler.bindEvent(editor, blazorConf.modelEvents, (e) => {
        update("html", editor.getContent());
        update("text", editor.getContent({ format: "text" }));
      });
      if (rteConf._setup && typeof rteConf._setup === "function") {
        rteConf._setup(editor, rteEventHandler);
      }
    };

    if (getHugeRTE()) {
      getHugeRTE().init(rteConf);
    } else {
      if (el && el.ownerDocument) {
        // inject HugeRTE here
        window.hugerteBlazorLoader.load(
          el.ownerDocument,
          blazorConf.src,
          () => {
            getHugeRTE().init(rteConf);
          },
        );
      }
    }
  },
  destroy: (el, id) => {
    if (getHugeRTE() && getHugeRTE().get(id)) {
      rteEventHandler.unbindEditor(id);
      getHugeRTE().get(id).remove();
    }
  },
};
