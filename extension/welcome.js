browser.storage.local.get({theme:"dark"}).then(settings=>{document.documentElement.dataset.theme=settings.theme;});
