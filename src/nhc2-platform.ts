import { Demand } from "@openhomekit/nhc2-hobby-api/lib/event/Demand";
import { Device } from "@openhomekit/nhc2-hobby-api/lib/event/device";
import { Event } from "@openhomekit/nhc2-hobby-api/lib/event/event";
import { FanSpeed } from "@openhomekit/nhc2-hobby-api/lib/event/FanSpeed";
import { Program } from "@openhomekit/nhc2-hobby-api/lib/event/Program";
import { NHC2 } from "@openhomekit/nhc2-hobby-api/lib/NHC2";
import {
  API,
  APIEvent,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";

import { NHC2Logger } from "./nhc2-logger";

const PLUGIN_NAME = "homebridge-nhc2";
const PLATFORM_NAME = "NHC2";

let hap: HAP;
let Accessory: typeof PlatformAccessory;

export = (api: API) => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NHC2Platform);
};

class NHC2Platform implements DynamicPlatformPlugin {
  private readonly Service: typeof Service = this.api.hap.Service;
  private readonly Characteristic: typeof Characteristic = this.api.hap
    .Characteristic;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly suppressedAccessories: string[] = [];
  private readonly nhc2: NHC2;

  private readonly log: NHC2Logger;

  constructor(
    private logger: Logging,
    private config: PlatformConfig,
    private api: API,
  ) {
    this.log = new NHC2Logger(this.logger, this.config);
    this.suppressedAccessories = config.suppressedAccessories || [];
    if (this.suppressedAccessories) {
      this.log.info("Suppressing accessories: ");
      this.suppressedAccessories.forEach(acc => {
        this.log.info("  - " + acc);
      });
    }
    this.nhc2 = new NHC2("mqtts://" + this.config.host, {
      port: this.config.port || 8884,
      clientId: this.config.clientId || "NHC2-homebridge",
      username: this.config.username || "hobby",
      password: this.config.password,
      rejectUnauthorized: false,
    });

    this.log.info("NHC2Platform finished initializing!");

    api.on(APIEvent.DID_FINISH_LAUNCHING, async () => {
      this.log.info("NHC2Platform 'didFinishLaunching'");

      await this.nhc2.subscribe();
      const nhc2Accessories = await this.nhc2.getAccessories();
      this.log.info("got " + nhc2Accessories.length + " accessories");
      this.addAccessories(nhc2Accessories);

      this.nhc2.getEvents().subscribe(event => {
        this.processEvent(event);
      });
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  public processEvent = (event: Event) => {
    this.log.debug("Event: ", JSON.stringify(event));
    if (!!event.Params) {
      event.Params.flatMap(param =>
        param.Devices.forEach((device: Device) => {
          const deviceAccessoryForEvent = this.findAccessoryDevice(device);
          if (!!deviceAccessoryForEvent) {
            deviceAccessoryForEvent.services.forEach(service =>
              this.processDeviceProperties(device, service),
            );
          }
        }),
      );
    }
  };

  private findAccessoryDevice(device: Device) {
    return this.accessories.find(accessory => accessory.UUID === device.Uuid);
  }

  private addAccessories(accessories: Device[]) {
    const mapping: { [index: string]: any } = {
      light: {
        service: this.Service.Lightbulb,
        handlers: [this.addStatusChangeCharacteristic],
      },
      dimmer: {
        service: this.Service.Lightbulb,
        handlers: [
          this.addStatusChangeCharacteristic,
          this.addBrightnessChangeCharacteristic,
        ],
      },
      socket: {
        service: this.Service.Outlet,
        handlers: [this.addStatusChangeCharacteristic],
      },
      generic: {
        service: this.Service.Switch,
        handlers: [this.addTriggerCharacteristic],
      },
      "switched-generic": {
        service: this.Service.Switch,
        handlers: [this.addStatusChangeCharacteristic],
      },
      "switched-fan": {
        service: this.Service.Fan,
        handlers: [this.addStatusChangeCharacteristic],
      },
      sunblind: {
        service: this.Service.WindowCovering,
        handlers: [this.addPositionChangeCharacteristic],
      },
      venetianblind: {
        service: this.Service.WindowCovering,
        handlers: [this.addPositionChangeCharacteristic],
      },
      rolldownshutter: {
        service: this.Service.WindowCovering,
        handlers: [this.addPositionChangeCharacteristic],
      },
      gate: {
        service: this.Service.WindowCovering,
        handlers: [this.addPositionChangeCharacteristic],
      },
      alloff: {
        service: this.Service.Switch,
        handlers: [this.addTriggerCharacteristic],
      },
      simulation: {
        service: this.Service.Switch,
        handlers: [this.addTriggerCharacteristic],
      },
      alarms: {
        service: this.Service.Switch,
        handlers: [this.addTriggerCharacteristic],
      },
      comfort: {
        service: this.Service.Switch,
        handlers: [this.addStatusChangeCharacteristic],
      },
      peakmode: {
        service: this.Service.Switch,
        handlers: [this.addTriggerCharacteristic],
      },
      solarmode: {
        service: this.Service.Switch,
        handlers: [this.addTriggerCharacteristic],
      },
      fan: {
        service: this.Service.Fan,
        handlers: [this.addOnFanCharacteristic, this.addOffFanCharacteristic],
      },
      thermostat: {
        service: this.Service.Thermostat,
        handlers: [
          this.addTargetTemperatureCharacteristic,
          this.addProgramCharacteristic,
        ],
      },
    };

    Object.keys(mapping).forEach(model => {
      const config = mapping[model];
      const accs = accessories.filter(
        acc =>
          !this.suppressedAccessories.includes(acc.Uuid) &&
          acc.Model === model &&
          (acc.Type === "action" || acc.Type === "thermostat"),
      );
      accs.forEach(acc => {
        const newAccessory = new Accessory(acc.Name as string, acc.Uuid);
        const newService = new config.service(acc.Name);
        config.handlers.forEach((handler: any) => {
          handler(newService, newAccessory);
        });
        newAccessory.addService(newService);
        this.processDeviceProperties(acc, newService);
        this.registerAccessory(newAccessory);
      });
    });
  }

  private registerAccessory(accessory: PlatformAccessory) {
    const existingAccessory = this.findExistingAccessory(accessory);
    if (!!existingAccessory) {
      this.unregisterAccessory(existingAccessory);
    }

    this.accessories.push(accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
      accessory,
    ]);
    this.log.debug(
      "registered accessory: " +
        accessory.displayName +
        " (" +
        accessory.UUID +
        ")",
    );
  }

  private unregisterAccessory(accessory: PlatformAccessory) {
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
      accessory,
    ]);
    this.accessories.splice(this.accessories.indexOf(accessory), 1);
    this.log.debug(
      "unregistered accessory: " +
        accessory.displayName +
        " (" +
        accessory.UUID +
        ")",
    );
  }

  private findExistingAccessory(newAccessory: PlatformAccessory) {
    return this.accessories
      .filter(accessory => accessory.UUID === newAccessory.UUID)
      .find(() => true);
  }

  private addStatusChangeCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.On)
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.nhc2.sendStatusChangeCommand(
            newAccessory.UUID,
            value as boolean,
          );
          callback();
        },
      );
  };

  private addBrightnessChangeCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.Brightness)
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.nhc2.sendBrightnessChangeCommand(
            newAccessory.UUID,
            value as number,
          );
          callback();
        },
      );
  };

  private addTriggerCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.On)
      .on(
        CharacteristicEventTypes.SET,
        (_: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.nhc2.sendTriggerBasicStateCommand(newAccessory.UUID);
          callback();
        },
      );
  };

  private addOnFanCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          const typedValue = value as number;
          switch (true) {
            case typedValue === 100:
              this.nhc2.sendFanSpeedCommand(newAccessory.UUID, FanSpeed.Boost);
              break;
            case typedValue >= 50:
              this.nhc2.sendFanSpeedCommand(newAccessory.UUID, FanSpeed.High);
              break;
            case typedValue === 0:
              this.nhc2.sendFanSpeedCommand(newAccessory.UUID, FanSpeed.Low);
              break;
            default:
              this.nhc2.sendFanSpeedCommand(newAccessory.UUID, FanSpeed.Medium);
          }
          callback();
        },
      );
  };

  private addOffFanCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.On)
      .on(
        CharacteristicEventTypes.SET,
        (_: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.nhc2.sendFanSpeedCommand(newAccessory.UUID, FanSpeed.Low);
          callback();
        },
      );
  };

  private addPositionChangeCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.TargetPosition)
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.nhc2.sendPositionChangeCommand(
            newAccessory.UUID,
            value as number,
          );
          callback();
        },
      );
  };

  private addTargetTemperatureCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.TargetTemperature)
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          if (
            (value as number) ===
            newService.getCharacteristic(this.Characteristic.CurrentTemperature)
              .value
          ) {
            this.nhc2.sendTempOverruleCommand(
              newAccessory.UUID,
              false,
              value as number,
            );
          } else {
            this.nhc2.sendTempOverruleCommand(
              newAccessory.UUID,
              true,
              value as number,
              60,
            );
          }
          callback();
        },
      );
  };

  private addProgramCharacteristic = (
    newService: Service,
    newAccessory: PlatformAccessory,
  ) => {
    newService
      .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          switch (value) {
            case 0:
              this.nhc2.sendProgramCommand(newAccessory.UUID, Program.Off);
              break;
            case 1:
              this.nhc2.sendProgramCommand(newAccessory.UUID, Program.Day);
              break;
            case 2:
              this.nhc2.sendProgramCommand(newAccessory.UUID, Program.Cool);
              break;
            default:
              this.nhc2.sendProgramCommand(newAccessory.UUID, Program.Prog1);
          }
          callback();
        },
      );
  };

  private processDeviceProperties(device: Device, service: Service) {
    // Super hacky, but for some reason every device has two services, one we added and another "AccessoryInformation".
    // We should not be modifying AccessoryInformation (This gives warnings);
    // If a better solution comes along please create a PR
    if (service.constructor.name === "AccessoryInformation") {
      return;
    }

    if (!!device.Properties) {
      device.Properties.forEach(property => {
        if (property.Status === "On" || property.BasicState === "On") {
          service.getCharacteristic(this.Characteristic.On).updateValue(true);
        }
        if (property.Status === "Off" || property.BasicState === "Off") {
          service.getCharacteristic(this.Characteristic.On).updateValue(false);
        }
        if (!!property.Brightness) {
          service
            .getCharacteristic(this.Characteristic.Brightness)
            .updateValue(property.Brightness);
        }
        if (!!property.FanSpeed) {
          switch (property.FanSpeed) {
            case FanSpeed.Boost:
              service
                .getCharacteristic(this.Characteristic.RotationSpeed)
                .updateValue(100);
              service
                .getCharacteristic(this.Characteristic.On)
                .updateValue(true);
              break;
            case FanSpeed.High:
              service
                .getCharacteristic(this.Characteristic.RotationSpeed)
                .updateValue(66);
              service
                .getCharacteristic(this.Characteristic.On)
                .updateValue(true);
              break;
            case FanSpeed.Medium:
              service
                .getCharacteristic(this.Characteristic.RotationSpeed)
                .updateValue(33);
              service
                .getCharacteristic(this.Characteristic.On)
                .updateValue(true);
              break;
            case FanSpeed.Low:
              service
                .getCharacteristic(this.Characteristic.RotationSpeed)
                .updateValue(0);
              service
                .getCharacteristic(this.Characteristic.On)
                .updateValue(false);
              break;
          }
        }
        if (!!property.Position) {
          const moving =
            device.Properties?.find(p => p.Moving)?.Moving === "True";
          service
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .updateValue(parseInt(property.Position, 10));
          service
            .getCharacteristic(this.Characteristic.PositionState)
            .updateValue(moving ? 1 : 2);
          /* TODO: find a way to determine INCREASING=1 or DECREASING=0 */

          if (!moving) {
            service
              .getCharacteristic(this.Characteristic.TargetPosition)
              .updateValue(parseInt(property.Position, 10));
          }
        }
        if (!!property.AmbientTemperature) {
          service
            .getCharacteristic(this.Characteristic.CurrentTemperature)
            .updateValue(parseFloat(property.AmbientTemperature));
          service
            .getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
            .updateValue(0);
        }
        if (!!property.SetpointTemperature) {
          switch (true) {
            // Niko has a min temp of 7 which homebridge cannot handle
            case parseFloat(property.SetpointTemperature) < 10:
              service
                .getCharacteristic(this.Characteristic.TargetTemperature)
                .updateValue(10);
              break;
            default:
              service
                .getCharacteristic(this.Characteristic.TargetTemperature)
                .updateValue(parseFloat(property.SetpointTemperature));
              break;
          }
        }
        if (!!property.Program) {
          switch (property.Program) {
            case Program.Off:
              service
                .getCharacteristic(
                  this.Characteristic.TargetHeatingCoolingState,
                )
                .updateValue(0);
              break;
            case Program.Day:
              service
                .getCharacteristic(
                  this.Characteristic.TargetHeatingCoolingState,
                )
                .updateValue(1);
              break;
            case Program.Cool:
              service
                .getCharacteristic(
                  this.Characteristic.TargetHeatingCoolingState,
                )
                .updateValue(2);
              break;
            default:
              service
                .getCharacteristic(
                  this.Characteristic.TargetHeatingCoolingState,
                )
                .updateValue(3);
              break;
          }
        }
        if (!!property.Demand) {
          switch (property.Demand) {
            case Demand.None:
              service
                .getCharacteristic(
                  this.Characteristic.CurrentHeatingCoolingState,
                )
                .updateValue(0);
              break;
            case Demand.Heating:
              service
                .getCharacteristic(
                  this.Characteristic.CurrentHeatingCoolingState,
                )
                .updateValue(1);
              service
                .getCharacteristic(
                  this.Characteristic.TargetHeatingCoolingState,
                )
                .updateValue(1);
              break;
            case Demand.Cooling:
              service
                .getCharacteristic(
                  this.Characteristic.CurrentHeatingCoolingState,
                )
                .updateValue(2);
              service
                .getCharacteristic(
                  this.Characteristic.TargetHeatingCoolingState,
                )
                .updateValue(2);
              break;
          }
        }
      });
    }
  }
}
