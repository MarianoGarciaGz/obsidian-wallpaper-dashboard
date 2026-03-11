var wallpaperSettings = {
    fps: 60
}

window.wallpaperPropertyListener = {
    applyGeneralProperties: function (properties) {
        if (properties.fps) {
            wallpaperSettings.fps = properties.fps
        }
    }
}

// Conservamos el script original
window.wallpaperPropertyListener = {
    applyUserProperties: function (properties) {
        if (properties.customcolor) {
            // Convert the custom color to 0 - 255 range for CSS usage
            var customColor = properties.customcolor.value.split(' ')
            customColor = customColor.map(function (c) {
                return Math.ceil(c * 255)
            })
            var customColorAsCSS = 'rgb(' + customColor + ')'
            var backgroundElement = document.getElementById('background')
            backgroundElement.style.backgroundColor = customColorAsCSS
        }
    }
}

