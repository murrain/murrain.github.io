+++
title = "A KDE Weather Widget With Four Fallback Sources"
date = 2026-02-28T09:00:00-08:00
draft = false
tags = ["kde", "qml", "ux"]
author = "Patrick Smith"
original_date = "2026-02-28"
source_repo = "kde-weather-widget"
ogTitle = "A KDE Weather Widget With Four Fallback Sources"
description = "Four weather providers behind one interface. The local USB sensor is just another source; if it dies, the widget switches instead of going blank."
image = "/img/kde-weather-widget-og.jpg"
+++

![KDE weather widget showing current conditions and 7-day forecast](/img/kde-weather-widget.jpg)

The obvious version of this widget talks directly to the local sensor API: one source, one URL, done. The problem is that it becomes useless the moment the sensor container goes down, which happens after reboots, during debugging, and on any machine that doesn't have the weather station running. A widget that requires you to mentally verify the backend before trusting the reading isn't a widget. It's a reminder that something might be broken.

I built the provider abstraction before building anything else. Four sources, four parsers, one normalized output shape:

```js
// Providers.js
function list() {
  return [
    {
      id: "openmeteo",
      parser: "openmeteo",
      requiresApiKey: false,
      requestTemplate: "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&...",
    },
    {
      id: "weathergov",
      parser: "weathergov",
      requiresApiKey: false,
      requestTemplate: "https://api.weather.gov/points/{lat},{lon}",
    },
    {
      id: "owm30",
      parser: "owm_onecall",
      requiresApiKey: true,
      requestTemplate: "https://api.openweathermap.org/data/3.0/onecall?lat={lat}&lon={lon}&appid={apiKey}&units=metric",
    },
    {
      id: "custom",
      parser: "owm_compatible",
      requiresEndpoint: true,
      requestTemplate: "{endpoint}",
    },
  ];
}
```

The local sensor connects via the `custom` provider. Its API endpoint returns OWM-compatible JSON, which `owm_compatible` parses. The widget has no idea it's talking to a USB dongle three feet away. It just sees a provider with an endpoint URL and a parser. Switching from local sensor to Open-Meteo is one config change.

Every parser normalizes to the same internal shape before the rendering layer sees anything: `current` with temperature, humidity, and a WMO weather code; `daily` with high/low and precipitation probability for seven days. The rendering code calls into this shape and only this shape.

Weather.gov had the most interesting implementation. The NWS API doesn't accept coordinates directly. You hit `api.weather.gov/points/{lat},{lon}` first, which returns a JSON document containing the actual forecast URLs for that location. Then you fetch those. Two HTTP requests to get what every other provider delivers in one.

```
GET api.weather.gov/points/37.77,-122.42
→ { "properties": { "forecast": "...", "forecastHourly": "..." } }

GET {forecast URL}
→ actual forecast data
```

This doesn't fit a generic single-fetch provider model. As a parser-specific implementation behind the same interface, it's fine. The `weathergov` parser does the two-hop and caches the resolved forecast URLs so subsequent fetches are single requests. The widget doesn't know or care.

The taskbar temperature I wanted in the first place was about fifteen minutes of QML after the provider abstraction was working.
