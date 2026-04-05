+++
title = "One Canonical Format. Five APIs. No Adapters."
date = 2026-03-03T00:00:00-08:00
draft = false
tags = ["kde", "qml", "javascript", "apis", "architecture"]
author = "Patrick Smith"
original_date = "2026-03-03"
source_repo = "kde-weather-widget"
+++

The weather widget talks to five different APIs. Each one returns data in its own format, so before anything reaches the display layer, every response gets normalized to a single internal schema.

The normalized shape every parser targets looks like this:

```javascript
{
  current: {
    temp: 20.5,          // always Celsius
    feels_like: 18.2,    // always Celsius
    humidity: 65,        // 0-100
    pressure: 1013.25,   // hPa
    wind_speed: 5.5,     // always m/s
    wind_deg: 180,       // 0-360
    weather: [{ description: "Partly cloudy", icon: "02d" }]
  },
  daily: [
    {
      dt: 1234567890,    // Unix timestamp
      temp: { max: 25.0, min: 15.0 },
      weather: [{ icon: "01d" }],
      pop: 0.3,          // precipitation probability, 0-1
      day_detail: { weather: [...], pop: 0.3 },
      night_detail: { weather: [...], pop: 0.1 }
    }
    // 6 more days
  ]
}
```

Temperature always Celsius. Wind always m/s. Icon codes, not icon URLs. Unit conversion happens at render time in the QML layer. The moment you let user preferences leak into parsing, you're debugging localization bugs inside HTTP response handlers.

Open-Meteo is the simplest normalizer. One API call, flat response, metric units already:

```javascript
function normalizeOpenMeteo(raw) {
  if (!raw.current || !raw.daily) return null

  var daily = []
  var dates = raw.daily.time || []
  for (var i = 0; i < dates.length; i++) {
    var dt = Date.parse(dates[i] + "T12:00:00Z") / 1000
    daily.push({
      dt: isNaN(dt) ? Math.floor(Date.now() / 1000) : Math.floor(dt),
      temp: {
        max: raw.daily.temperature_2m_max[i],
        min: raw.daily.temperature_2m_min[i],
      },
      weather: [openMeteoCodeToWeather(raw.daily.weather_code[i], 1)],
      pop: Number(raw.daily.precipitation_probability_max[i] || 0) / 100.0,
    })
  }

  return {
    current: {
      temp: raw.current.temperature_2m,
      feels_like: raw.current.apparent_temperature,
      humidity: raw.current.relative_humidity_2m,
      wind_speed: raw.current.wind_speed_10m,
      wind_deg: raw.current.wind_direction_10m,
      weather: [openMeteoCodeToWeather(raw.current.weather_code, raw.current.is_day)]
    },
    daily: daily
  }
}
```

Read the field, slot it into the canonical shape, move on. The weather.gov normalizer is the hard case: three sequential calls, Fahrenheit responses that need conversion, day/night periods that need merging. More work, same destination.

Every normalizer can fail, though. They return `null` on failure. A validation step checks the canonical shape before anything reaches the UI. Missing fields produce named error messages: "missing current.temp", "missing daily[2].weather". When you're integrating a new provider, the failure tells you exactly which field mapping you got wrong.

The runtime makes this trickier than it sounds. Plasma widgets have no disk I/O. No `localStorage`, no file system. You get `XMLHttpRequest` and `Date()`. That's it. This matters for weather.gov because of the two-hop resolution. The points endpoint returns forecast URLs that don't change for a given coordinate pair. Without disk, caching those URLs means a QML property:

```javascript
property var weatherGovCache: ({ key: "", hourlyUrl: "", dailyUrl: "" })

function fetchWeatherGov(pointsUrl, provider) {
  var cacheKey = lat + "," + lon
  if (weatherGovCache.key === cacheKey && weatherGovCache.hourlyUrl) {
    fetchWeatherGovForecasts(weatherGovCache.hourlyUrl, weatherGovCache.dailyUrl, ...)
    return
  }
  // First call: resolve points -> forecast URLs
  requestJson(pointsUrl, 15000, {}, function(points) {
    weatherGovCache = {
      key: cacheKey,
      hourlyUrl: points.properties.forecastHourly,
      dailyUrl: points.properties.forecast
    }
    fetchWeatherGovForecasts(weatherGovCache.hourlyUrl, weatherGovCache.dailyUrl, ...)
  }, ...)
}
```

Keyed on `"{lat},{lon}"`. Survives for the widget's lifetime, clears on restart. The Plasma sandbox forced exactly the right scope: cache the URL resolution, cache nothing else.
