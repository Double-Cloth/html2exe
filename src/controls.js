// 配置字段仍由原表单保存；这里仅替换用户看到和操作的控件。
(() => {
  const controls = [];
  let opened = null;

  function icon(path, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add(className);
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    return svg;
  }

  function createControl(source, editable) {
    const optionsSource = editable ? document.getElementById(source.dataset.options) : source;
    if (!optionsSource) return;
    const wrapper = document.createElement("div");
    wrapper.className = editable ? "custom-combobox" : "custom-select";
    source.before(wrapper);
    wrapper.append(source);

    const trigger = editable ? source : document.createElement("button");
    let valueLabel;
    if (!editable) {
      source.hidden = true;
      trigger.type = "button";
      trigger.id = `${source.id}-control`;
      trigger.className = "select-control";
      valueLabel = document.createElement("span");
      valueLabel.className = "control-value";
      valueLabel.id = `${source.id}-value`;
      trigger.append(valueLabel, icon("m6 9 6 6 6-6", "control-arrow"));
      wrapper.append(trigger);
      const label = document.querySelector(`label[for="${source.id}"]`);
      if (label) {
        label.id = label.id || `${source.id}-label`;
        label.htmlFor = trigger.id;
        trigger.setAttribute("aria-labelledby", `${label.id} ${valueLabel.id}`);
      }
    } else {
      source.autocomplete = "off";
      source.setAttribute("aria-autocomplete", "list");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "combobox-toggle";
      toggle.tabIndex = -1;
      toggle.setAttribute("aria-label", "展开版本候选列表");
      toggle.append(icon("m6 9 6 6 6-6", "control-arrow"));
      toggle.addEventListener("pointerdown", (event) => event.preventDefault());
      toggle.addEventListener("click", () => {
        if (source.disabled) return;
        trigger.focus();
        if (opened === control) close();
        else open();
      });
      wrapper.append(toggle);
    }

    const list = document.createElement("div");
    list.id = `${source.id}-listbox`;
    list.className = "custom-options";
    list.setAttribute("popover", "manual");
    list.setAttribute("role", "listbox");
    const fieldLabel = document.querySelector(`label[for="${trigger.id}"]`);
    list.setAttribute("aria-label", fieldLabel?.textContent.trim() || source.id);
    document.body.append(list);
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-controls", list.id);
    trigger.setAttribute("aria-expanded", "false");

    let items = [];
    let activeIndex = -1;
    let query = "";
    let search = "";
    let searchedAt = 0;

    function close() {
      if (opened !== control) return;
      list.hidePopover();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      opened = null;
    }

    function setActive(index, scroll = true) {
      activeIndex = index;
      Array.from(list.children).forEach((row, rowIndex) => {
        row.classList.toggle("is-active", rowIndex === index);
      });
      const row = list.children[index];
      if (index >= 0 && row) {
        trigger.setAttribute("aria-activedescendant", row.id);
        if (scroll) row.scrollIntoView({ block: "nearest" });
      } else {
        trigger.removeAttribute("aria-activedescendant");
      }
    }

    function render() {
      const filter = query.trim().toLowerCase();
      items = Array.from(optionsSource.options).filter((option) => !option.hidden &&
        (!editable || !filter || `${option.value} ${option.label}`.toLowerCase().includes(filter)));
      list.replaceChildren();
      items.forEach((option, index) => {
        const row = document.createElement("div");
        row.id = `${list.id}-${index}`;
        row.className = "custom-option";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(option.value === source.value));
        row.setAttribute("aria-disabled", String(option.disabled));
        const copy = document.createElement("span");
        copy.className = "option-copy";
        copy.textContent = editable ? option.value : option.label;
        if (editable && option.label && option.label !== option.value) {
          const detail = document.createElement("span");
          detail.className = "option-detail";
          detail.textContent = option.label;
          copy.append(detail);
        }
        row.append(copy, icon("m5 12 4 4L19 6", "option-check"));
        row.addEventListener("pointermove", () => {
          if (!option.disabled) setActive(index, false);
        });
        row.addEventListener("click", () => choose(index));
        list.append(row);
      });
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "custom-options-empty";
        empty.textContent = "无匹配候选，可继续输入自定义版本。";
        list.append(empty);
      }
      setActive(items.findIndex((option) => !option.disabled && option.value === source.value), false);
    }

    function position() {
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return close();
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const upward = below < 240 && above > below;
      list.dataset.placement = upward ? "above" : "below";
      list.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
      list.style.maxHeight = `${Math.max(0, Math.min(280, upward ? above - 4 : below - 4))}px`;
      list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - list.offsetWidth - 8))}px`;
      list.style.top = `${upward ? rect.top - list.offsetHeight - 4 : rect.bottom + 4}px`;
    }

    function open(filter = "") {
      if (source.disabled) return;
      if (opened && opened !== control) opened.close();
      query = filter;
      render();
      if (opened !== control) list.showPopover();
      opened = control;
      trigger.setAttribute("aria-expanded", "true");
      position();
      setActive(activeIndex);
    }

    function choose(index) {
      const option = items[index];
      if (!option || option.disabled || source.disabled) return;
      const changed = source.value !== option.value;
      source.value = option.value;
      close();
      sync();
      trigger.focus();
      if (changed) {
        source.dispatchEvent(new Event("input", { bubbles: true }));
        source.dispatchEvent(new Event("change", { bubbles: true }));
        // input 事件会刷新可编辑候选，选择完成后仍应收起。
        close();
      }
    }

    function sync() {
      if (!editable) {
        valueLabel.textContent = source.selectedOptions[0]?.label || "请选择";
        trigger.title = valueLabel.textContent;
        trigger.disabled = source.disabled;
      } else {
        wrapper.querySelector("button").disabled = source.disabled;
      }
      if (source.disabled) close();
      else if (opened === control) {
        render();
        position();
        setActive(activeIndex);
      }
    }

    const control = { trigger, wrapper, list, sync, close, position };
    controls.push(control);
    if (!editable) trigger.addEventListener("click", () => opened === control ? close() : open());
    else source.addEventListener("input", () => open(source.value));
    source.addEventListener("change", sync);
    list.addEventListener("pointerdown", (event) => event.preventDefault());
    trigger.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const isOpen = opened === control;
      if (event.key === "Escape") {
        if (isOpen) { event.preventDefault(); event.stopPropagation(); close(); }
        return;
      }
      if (event.key === "Tab") return close();
      if (event.key === "Enter" || (!editable && event.key === " ")) {
        event.preventDefault();
        if (isOpen) { if (activeIndex >= 0) choose(activeIndex); else close(); }
        else if (!editable) open();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp" ||
          (!editable && (event.key === "Home" || event.key === "End"))) {
        event.preventDefault();
        if (!isOpen) open();
        const enabled = items.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
        if (!enabled.length) return;
        let next = enabled.indexOf(activeIndex);
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = enabled.length - 1;
        else if (next < 0) next = event.key === "ArrowUp" ? enabled.length - 1 : 0;
        else if (isOpen) next = Math.max(0, Math.min(enabled.length - 1, next + (event.key === "ArrowDown" ? 1 : -1)));
        setActive(enabled[next]);
        return;
      }
      if (!editable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        search = (now - searchedAt < 700 ? search : "") + event.key.toLowerCase();
        searchedAt = now;
        if (!isOpen) open();
        const index = items.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(search));
        if (index >= 0) setActive(index);
      }
    });
    wrapper.addEventListener("focusout", (event) => {
      if (!wrapper.contains(event.relatedTarget)) close();
    });
    new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ["disabled"], childList: !editable, subtree: !editable, characterData: !editable });
    if (editable) new MutationObserver(sync).observe(optionsSource, { childList: true, subtree: true, attributes: true });
    sync();
  }

  document.querySelectorAll(".tab-content select").forEach((source) => createControl(source, false));
  document.querySelectorAll("input[data-options]").forEach((source) => createControl(source, true));
  document.addEventListener("pointerdown", (event) => {
    if (opened && !opened.wrapper.contains(event.target) && !opened.list.contains(event.target)) opened.close();
  });
  document.addEventListener("scroll", (event) => {
    if (opened && !opened.list.contains(event.target)) opened.position();
  }, true);
  window.addEventListener("resize", () => opened?.position());
  window.customFormControls = { sync: () => controls.forEach((control) => control.sync()) };
})();
