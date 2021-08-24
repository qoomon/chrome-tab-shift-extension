Array.prototype.selectAdjacent = function(originIndex, predicate) {
  let origin = this[originIndex]

  if (!predicate(origin)) {
    return []
  }

  let result = [origin]

  let leftIndex = originIndex - 1
  let left = this[leftIndex]

  while (left && predicate(left)) {
    result.unshift(left)
    leftIndex -= 1
    left = this[leftIndex]
  }

  let rightIndex = originIndex + 1
  let right = this[rightIndex]

  while (right && predicate(right)) {
    result.push(right)
    rightIndex += 1
    right = this[rightIndex]
  }

  return result
}

chrome.tabs.shift = async (tabIds, shift) => Promise.all(tabIds
  .map(async tabId => chrome.tabs.get(tabId))
  .map(async tab => chrome.tabs.move((await tab).id, {
    index: (await tab).index + shift
  })))

chrome.tabGroups.swap = async (group0Id, group1Id) => {
  let currentWindowTabs = await chrome.tabs.query({
    currentWindow: true
  })
  let group0Tab = currentWindowTabs.find(tab => tab.groupId === group0Id)
  let group1Tab = currentWindowTabs.find(tab => tab.groupId === group1Id)

  let leftGroupTab = group0Tab
  let rightGroupId = group1Id
  if (group0Tab.index > group1Tab.index) {
    leftGroupTab = group1Tab
    rightGroupId = group0Id
  }
  return chrome.tabGroups.move(rightGroupId, {
    index: leftGroupTab.index
  })
}

// -----------------------------------------------------------------------------

async function shiftTabs(tabs, direction) {
  let currentWindowTabs = await chrome.tabs.query({
    currentWindow: true
  })

  let shiftSign = direction === 'left' ? -1 : +1
  let orientedTabs = direction === 'left' ? tabs : tabs.slice().reverse()
  let orientedTabIds = orientedTabs.map(tab => tab.id)

  let anchorTab = orientedTabs[0]
  let targetTab = currentWindowTabs[anchorTab.index + shiftSign]

  let isAnchorTabAtEdge = !targetTab || targetTab.pinned !== anchorTab.pinned

  // --- handle ungrouped tags -------------------------------------------------
  if (anchorTab.groupId < 0) {
    // --- ...at edge ----------------------------------------------------------
    if (isAnchorTabAtEdge) {
      console.debug("tabs reached edge")
      return
    }

    // --- ...towards ungrouped tab --------------------------------------------
    if (targetTab.groupId < 0) {
      console.debug("shift tabs")
      return chrome.tabs.shift(orientedTabIds, shiftSign)
    }

    // --- ...towards group ----------------------------------------------------
    {
      console.debug("group tabs")
      return chrome.tabs.group({
        tabIds: orientedTabIds,
        groupId: targetTab.groupId
      })
    }
  }

  // --- handle grouped tags shift ---------------------------------------------
  if (anchorTab.groupId >= 0) {
    let tabGroupTabs = currentWindowTabs.filter(tab => tab.groupId === anchorTab.groupId)
    let isTabGroupSelected = tabGroupTabs.length === tabs.length

    // --- ...at edge ----------------------------------------------------------
    if (isAnchorTabAtEdge) {
      if (isTabGroupSelected) {
        console.debug("tabs reached edge")
        return
      } else {
        console.debug("ungroup tabs")
        return chrome.tabs.ungroup(orientedTabIds)
      }
    }

    // --- ...within same group ------------------------------------------------
    if (targetTab.groupId === anchorTab.groupId) {
      console.debug("shift tabs")
      return chrome.tabs.shift(orientedTabIds, shiftSign)
    }

    // --- ...towards other group ----------------------------------------------
    if (targetTab.groupId >= 0) {
      if (isTabGroupSelected) {
        console.debug("move tab group")
        return chrome.tabGroups.swap(anchorTab.groupId, targetTab.groupId)
      } else {
        console.debug("ungroup tabs")
        return chrome.tabs.ungroup(orientedTabIds)
      }
    }

    // --- ...towards ungrouped ------------------------------------------------
    {
      if (isTabGroupSelected) {
        console.debug("move tab group")
        return chrome.tabGroups.move(anchorTab.groupId, {
          index: tabs[0].index + shiftSign
        })
      } else {
        console.debug("ungroup tabs")
        return chrome.tabs.ungroup(orientedTabIds)
      }
    }
  }
}

async function shiftTabsToEdge(tabs, direction) {
  let currentWindowTabs = await chrome.tabs.query({
    currentWindow: true
  })

  let isTabGroupSelected = tabs[0].groupId >= 0 && currentWindowTabs
    .filter(tab => tab.groupId === tabs[0].groupId)
    .every(groupTab => tabs.find(tab => tab.id === groupTab.id))

  let shiftSign = direction === 'left' ? -1 : +1
  let orientedTabs = direction === 'left' ? tabs : tabs.slice().reverse()
  let orientedTabIds = orientedTabs.map(tab => tab.id)

  let anchorTab = orientedTabs[0]
  let targetTab = anchorTab
  if (anchorTab.pinned) {
    targetTab = direction === 'left' ?
      currentWindowTabs[0] :
      currentWindowTabs.slice().reverse().find(tab => tab.pinned)
  } else if (anchorTab.groupId >= 0) {
    if (isTabGroupSelected) {
      targetTab = direction === 'left' ?
        currentWindowTabs.find(tab => !tab.pinned) :
        currentWindowTabs.slice().reverse()[0]
    } else {
      targetTab = direction === 'left' ?
        currentWindowTabs.find(tab => tab.groupId === anchorTab.groupId) :
        currentWindowTabs.slice().reverse().find(tab => tab.groupId === anchorTab.groupId)
    }
  } else {
    targetTab = direction === 'left' ?
      currentWindowTabs.find(tab => !tab.pinned) :
      currentWindowTabs.slice().reverse()[0]
  }

  let shift = targetTab.index - anchorTab.index
  if (shift) {
    // --- handle ungrouped tags -----------------------------------------------
    if (anchorTab.groupId < 0) {
      console.debug("move tabs")
      return chrome.tabs.shift(orientedTabIds, shift)
    }

    // --- handle grouped tags -------------------------------------------------
    if (anchorTab.groupId >= 0) {
      if (isTabGroupSelected) {
        console.debug("move tab group")
        return chrome.tabGroups.move(anchorTab.groupId, {
          index: targetTab.index
        })
      } else {
        console.debug("move tabs")
        return chrome.tabs.shift(orientedTabIds, shift)
      }
    }
  } else {
    console.debug("tabs reached edge")
    return
  }
}

async function shiftSelectedTabs(direction) {
  let currentWindowTabs = await chrome.tabs.query({
    currentWindow: true
  })

  let [activeTab] = await chrome.tabs.query({
    currentWindow: true,
    active: true
  })

  let selectedTabs = currentWindowTabs.selectAdjacent(activeTab.index, tab =>
    tab.highlighted &&
    tab.groupId === activeTab.groupId &&
    tab.pinned === activeTab.pinned)

  // update selection  
  chrome.tabs.highlight({
    tabs: selectedTabs.map(tab => tab.index)
  })

  switch (direction) {
    case 'left':
      return shiftTabs(selectedTabs, 'left')
    case 'right':
      return shiftTabs(selectedTabs, 'right')

    case 'left-edge':
      return shiftTabsToEdge(selectedTabs, 'left')
    case 'right-edge': {
      return shiftTabsToEdge(selectedTabs, 'right')
    }
  }
}

// -----------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  console.debug(`command: ${command}`)
  switch (command) {
    case 'shift-tab-left':
    case 'shift-tab-right':
    case 'shift-tab-left-edge':
    case 'shift-tab-right-edge':
      return shiftSelectedTabs(command.replace('shift-tab-', ''))
  }
})