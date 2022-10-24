# Changelog

## v2.0.0
* Added support for suppressing accessories
  
* Added actions
  * toggle basic state change on generic devices (free start stop actions)
  * change position (e.g. of sunblinds)
  * toggle light status
  * set light brightness level

## v3.1.0

* Filtered out devices that are not controlable (only actions and routines)

* Added actions
  * Basic fan control (switched-fan)
  * Ventilation control (fan)
    * 0 = Low 
    * 1-49 = Medium 
    * 50-99 = High 
    * 100 = Boost
* Added routines
  * All-Off
  * Presence Simulation
  * Alarms
  * Scenes (comfort)
  * Peak Mode
  * Solar Mode

## v3.2.0

* Added support for thermostats

## v3.3.0

* Added support for thermostat programs
  * Homebridge --> Niko
    * Off       -->   Off
    * Heating   -->   Day
    * Cooling   -->   Cool
    * Auto      -->   Prog 1
  * Any other programs selected in Niko will display as Auto
  * Min temp for homebridge is 10 where as Niko supports as low as 7. 
    * Any temp set under 10 degrees in Niko will be displayed as 10. 
  * Changed the default override time from 24h to 60min