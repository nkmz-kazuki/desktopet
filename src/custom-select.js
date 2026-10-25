(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.customSelect = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let openedControl = null;

  function create({ select, options, panel, scrollBoundary, footer }) {
    const trigger = document.querySelector(`#${select.id}Trigger`);
    const valueNode = document.querySelector(`#${select.id}Value`);
    const listbox = document.createElement('div');
    listbox.id = `${select.id}Listbox`;
    listbox.className = 'select-listbox';
    listbox.hidden = true;
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-labelledby', `${select.id}Label`);
    panel.appendChild(listbox);
    select.replaceChildren();
    const optionNodes = [];
    const groups = new Map();
    let activeIndex = 0;
    let isOpen = false;

    options.forEach((option, index) => {
      let parent = listbox;
      let nativeParent = select;
      if (option.group) {
        if (!groups.has(option.group)) {
          const group = document.createElement('div');
          group.className = 'select-group';
          group.setAttribute('role', 'group');
          const heading = document.createElement('div');
          heading.id = `${select.id}Group${groups.size}`;
          heading.className = 'select-group-title';
          heading.textContent = option.group;
          group.setAttribute('aria-labelledby', heading.id);
          group.appendChild(heading);
          listbox.appendChild(group);
          const nativeGroup = document.createElement('optgroup');
          nativeGroup.label = option.group;
          select.appendChild(nativeGroup);
          groups.set(option.group, { group, nativeGroup });
        }
        ({ group: parent, nativeGroup: nativeParent } = groups.get(option.group));
      }
      const nativeOption = document.createElement('option');
      nativeOption.value = option.id;
      nativeOption.textContent = option.label;
      nativeParent.appendChild(nativeOption);
      const node = document.createElement('div');
      node.id = `${select.id}Option${index}`;
      node.className = 'select-option';
      node.dataset.value = option.id;
      node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', 'false');
      node.textContent = option.label;
      node.addEventListener('pointerdown', (event) => event.preventDefault());
      node.addEventListener('pointermove', () => activate(index));
      node.addEventListener('click', () => choose(index));
      parent.appendChild(node);
      optionNodes.push(node);
    });

    function sync() {
      let selectedIndex = options.findIndex((option) => option.id === select.value);
      if (selectedIndex < 0) {
        selectedIndex = 0;
        select.value = options[0].id;
      }
      valueNode.textContent = options[selectedIndex].label;
      optionNodes.forEach((node, index) => node.setAttribute('aria-selected', String(index === selectedIndex)));
      if (isOpen) activate(selectedIndex);
      return selectedIndex;
    }

    function activate(index) {
      activeIndex = Math.max(0, Math.min(options.length - 1, index));
      optionNodes.forEach((node, itemIndex) => node.classList.toggle('is-active', itemIndex === activeIndex));
      trigger.setAttribute('aria-activedescendant', optionNodes[activeIndex].id);
      const option = optionNodes[activeIndex];
      if (option.offsetTop < listbox.scrollTop) listbox.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > listbox.scrollTop + listbox.clientHeight) {
        listbox.scrollTop = option.offsetTop + option.offsetHeight - listbox.clientHeight;
      }
    }

    function place() {
      const panelRect = panel.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const contentRect = scrollBoundary.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const scaleX = panelRect.width / panel.offsetWidth || 1;
      const scaleY = panelRect.height / panel.offsetHeight || 1;
      const minTop = Math.max(panelRect.top + 8 * scaleY, contentRect.top + 4 * scaleY);
      const maxBottom = Math.min(panelRect.bottom - 8 * scaleY, contentRect.bottom - 4 * scaleY, footerRect.top - 4 * scaleY);
      const width = Math.min(Math.max(triggerRect.width, 160 * scaleX), panelRect.width - 16 * scaleX);
      listbox.style.width = `${width / scaleX}px`;
      listbox.style.maxHeight = 'none';
      const wantedHeight = Math.min(listbox.scrollHeight + 2, 260) * scaleY;
      const below = maxBottom - triggerRect.bottom - 6 * scaleY;
      const above = triggerRect.top - 6 * scaleY - minTop;
      const upward = below < wantedHeight && above > below;
      const height = Math.min(wantedHeight, Math.max(36 * scaleY, upward ? above : below), maxBottom - minTop);
      const top = Math.max(minTop, Math.min(maxBottom - height, upward ? triggerRect.top - height - 6 * scaleY : triggerRect.bottom + 6 * scaleY));
      const left = Math.max(panelRect.left + 8 * scaleX, Math.min(panelRect.right - width - 8 * scaleX, triggerRect.left));
      listbox.style.left = `${(left - panelRect.left) / scaleX - panel.clientLeft}px`;
      listbox.style.top = `${(top - panelRect.top) / scaleY - panel.clientTop}px`;
      listbox.style.maxHeight = `${height / scaleY}px`;
      listbox.dataset.placement = upward ? 'top' : 'bottom';
    }

    function close({ restoreFocus = false } = {}) {
      if (!isOpen) return;
      isOpen = false;
      listbox.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      if (openedControl === control) openedControl = null;
      if (restoreFocus) trigger.focus();
    }

    function open() {
      if (isOpen || trigger.disabled || !panel.classList.contains('open')) return;
      openedControl?.close();
      const selectedIndex = sync();
      isOpen = true;
      openedControl = control;
      listbox.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      place();
      activate(selectedIndex);
    }

    function choose(index) {
      if (!isOpen) return;
      select.value = options[index].id;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close({ restoreFocus: true });
    }

    trigger.addEventListener('click', () => { if (isOpen) close(); else open(); });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'Escape') {
        if (isOpen) { event.preventDefault(); close({ restoreFocus: true }); }
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Enter' || event.key === ' ') {
        if (isOpen) choose(activeIndex);
        else open();
        return;
      }
      const wasOpen = isOpen;
      open();
      if (!isOpen) return;
      if (event.key === 'Home') activate(0);
      else if (event.key === 'End') activate(options.length - 1);
      else if (wasOpen) activate(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
    });
    select.addEventListener('input', sync);
    select.addEventListener('change', sync);
    document.addEventListener('pointerdown', (event) => {
      if (!trigger.contains(event.target) && !listbox.contains(event.target)) close();
    });
    scrollBoundary.addEventListener('scroll', () => close());
    window.addEventListener('blur', () => close());
    window.addEventListener('resize', () => close());
    const control = { sync, open, close };
    sync();
    return control;
  }

  return { create };
}));
