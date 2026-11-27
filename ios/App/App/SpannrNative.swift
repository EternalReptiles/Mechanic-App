import Capacitor
import ProximityReader
import UIKit

/// Spannr's main screen: Capacitor's web view, plus Spannr's own native plugins.
class SpannrViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TapToPayEducationPlugin())
    }
}

/// Apple's "How to Tap" guide for Tap to Pay on iPhone (required by Apple before review).
@objc(TapToPayEducationPlugin)
public class TapToPayEducationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TapToPayEducationPlugin"
    public let jsName = "TapToPayEducation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showHowToTap", returnType: CAPPluginReturnPromise),
    ]

    /// Whether this iPhone can do Tap to Pay, and whether Apple's built-in guide is available (iOS 18+).
    @objc func status(_ call: CAPPluginCall) {
        var supported = false
        if #available(iOS 15.4, *) {
            supported = PaymentCardReader.isSupported
        }
        var education = false
        if #available(iOS 18.0, *) {
            education = true
        }
        call.resolve(["supported": supported, "education": education])
    }

    /// Shows Apple's localised "How to Tap" screens over the app.
    @objc func showHowToTap(_ call: CAPPluginCall) {
        guard #available(iOS 18.0, *) else {
            call.resolve(["shown": false])
            return
        }
        Task { @MainActor in
            do {
                let discovery = ProximityReaderDiscovery()
                let content = try await discovery.content(for: .payment(.howToTap))
                guard var top = self.bridge?.viewController else {
                    call.reject("Spannr isn't ready yet")
                    return
                }
                while let presented = top.presentedViewController {
                    top = presented
                }
                try await discovery.presentContent(content, from: top)
                call.resolve(["shown": true])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}
